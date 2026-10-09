import type { Market, Venue } from "./types";

const POLY = "https://gamma-api.polymarket.com";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const KALSHI_FEE_RATE = 0.07;

const num = (v: unknown, d = 0): number => {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : d;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  try {
    const a = JSON.parse(String(v ?? "[]"));
    return Array.isArray(a) ? a.map(String) : [];
  } catch {
    return [];
  }
}

async function getJson(url: string, timeoutMs = 10000): Promise<any> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

// ---------- Polymarket ----------

function polyToMarket(m: any): Market | null {
  const outcomes = parseJsonArray(m.outcomes);
  if (outcomes.length !== 2) return null;
  if (m.closed || m.acceptingOrders === false || m.enableOrderBook === false) return null;
  const bestBid = num(m.bestBid, NaN);
  const bestAsk = num(m.bestAsk, NaN);
  if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk) || bestAsk <= 0 || bestAsk >= 1) return null;
  const ev = Array.isArray(m.events) ? m.events[0] : undefined;
  const slug = ev?.slug || m.slug;
  const fee = m.feesEnabled ? num(m.feeSchedule?.rate, 0) : 0;
  return {
    venue: "polymarket",
    id: String(m.id),
    group: String(ev?.id ?? m.id),
    question: String(m.question ?? ""),
    context: [ev?.title, m.groupItemTitle].filter(Boolean).join(" · "),
    outcomes: [outcomes[0], outcomes[1]],
    ask: [clamp01(bestAsk), clamp01(1 - bestBid)],
    bid: [clamp01(bestBid), clamp01(1 - bestAsk)],
    volume24h: num(m.volume24hr),
    liquidity: num(m.liquidityNum ?? m.liquidity),
    closesAt: m.endDate ? new Date(m.endDate).toISOString() : null,
    url: `https://polymarket.com/event/${slug}`,
    rules: String(m.description ?? "").slice(0, 600),
    feeRate: fee,
  };
}

export async function fetchPolymarket(pages = 8): Promise<Market[]> {
  // The Gamma API caps page size at 100, so fetch the top N pages by 24h volume in parallel.
  const urls = Array.from(
    { length: pages },
    (_, i) => `${POLY}/markets?active=true&closed=false&limit=100&offset=${i * 100}&order=volume24hr&ascending=false`,
  );
  const results = await Promise.allSettled(urls.map((u) => getJson(u, 15000)));
  const out: Market[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status !== "fulfilled" || !Array.isArray(r.value)) continue;
    for (const raw of r.value) {
      const m = polyToMarket(raw);
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        out.push(m);
      }
    }
  }
  if (out.length === 0) {
    const err = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (err) throw err.reason;
  }
  return out;
}

// ---------- Kalshi ----------

function kalshiToMarket(m: any): Market | null {
  if (m.market_type && m.market_type !== "binary") return null;
  const yesBid = num(m.yes_bid_dollars);
  const yesAsk = num(m.yes_ask_dollars, 1);
  const noBid = num(m.no_bid_dollars, 1 - yesAsk);
  const noAsk = num(m.no_ask_dollars, 1 - yesBid);
  if (yesAsk <= 0 || yesAsk >= 1 || noAsk <= 0 || noAsk >= 1) return null;
  const mid = (yesBid + yesAsk) / 2;
  const series = String(m.event_ticker ?? m.ticker).split("-")[0].toLowerCase();
  const sub = [m.yes_sub_title, m.subtitle].filter((s: unknown) => typeof s === "string" && s).join(" · ");
  return {
    venue: "kalshi",
    id: String(m.ticker),
    group: String(m.event_ticker ?? m.ticker),
    question: String(m.title ?? m.ticker),
    context: sub,
    outcomes: ["Yes", "No"],
    ask: [clamp01(yesAsk), clamp01(noAsk)],
    bid: [clamp01(yesBid), clamp01(noBid)],
    volume24h: num(m.volume_24h_fp ?? m.volume_24h) * (num(m.last_price_dollars, mid) || mid),
    liquidity: num(m.open_interest_fp ?? m.open_interest) * mid,
    closesAt: m.close_time ? new Date(m.close_time).toISOString() : null,
    url: `https://kalshi.com/markets/${series}`,
    rules: [m.rules_primary, m.rules_secondary].filter(Boolean).join(" ").slice(0, 600),
    feeRate: KALSHI_FEE_RATE,
  };
}

export async function fetchKalshi(maxDaysToClose: number, maxPages = 4): Promise<Market[]> {
  const maxClose = Math.floor(Date.now() / 1000) + Math.max(1, maxDaysToClose) * 86400;
  const out: Market[] = [];
  let cursor = "";
  for (let page = 0; page < maxPages; page++) {
    const url =
      `${KALSHI}/markets?status=open&limit=1000&mve_filter=exclude&max_close_ts=${maxClose}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await getJson(url, 15000);
    for (const raw of data.markets ?? []) {
      const m = kalshiToMarket(raw);
      // Skip dead books: nothing traded today and almost nothing held.
      if (m && (m.volume24h > 0 || m.liquidity >= 50)) out.push(m);
    }
    cursor = data.cursor ?? "";
    if (!cursor) break;
  }
  return out;
}

// ---------- Quotes for open positions ----------

export interface Quote {
  bid: [number, number];
  ask: [number, number];
  /** Per-share payout of each outcome once the market has resolved, else null. */
  payout: [number, number] | null;
  feeRate: number;
}

export function quoteFromMarket(m: Market): Quote {
  return { bid: m.bid, ask: m.ask, payout: null, feeRate: m.feeRate };
}

export async function fetchQuote(venue: Venue, id: string): Promise<Quote | null> {
  try {
    if (venue === "polymarket") {
      const m = await getJson(`${POLY}/markets/${encodeURIComponent(id)}`);
      const prices = parseJsonArray(m.outcomePrices).map((p) => num(p, NaN));
      const feeRate = m.feesEnabled ? num(m.feeSchedule?.rate, 0) : 0;
      if (m.closed && prices.length === 2 && prices.every((p) => p === 0 || p === 1 || p === 0.5)) {
        return { bid: [prices[0], prices[1]], ask: [prices[0], prices[1]], payout: [prices[0], prices[1]], feeRate };
      }
      const bestBid = num(m.bestBid, prices[0] ?? 0);
      const bestAsk = num(m.bestAsk, prices[0] ?? 1);
      return {
        bid: [clamp01(bestBid), clamp01(1 - bestAsk)],
        ask: [clamp01(bestAsk), clamp01(1 - bestBid)],
        payout: null,
        feeRate,
      };
    }
    const data = await getJson(`${KALSHI}/markets/${encodeURIComponent(id)}`);
    const m = data.market ?? data;
    const result = String(m.result ?? "").toLowerCase();
    if (result === "yes" || result === "no") {
      const payout: [number, number] = result === "yes" ? [1, 0] : [0, 1];
      return { bid: payout, ask: payout, payout, feeRate: KALSHI_FEE_RATE };
    }
    const yesBid = num(m.yes_bid_dollars);
    const yesAsk = num(m.yes_ask_dollars, 1);
    return {
      bid: [yesBid, num(m.no_bid_dollars, 1 - yesAsk)],
      ask: [yesAsk, num(m.no_ask_dollars, 1 - yesBid)],
      payout: null,
      feeRate: KALSHI_FEE_RATE,
    };
  } catch {
    return null;
  }
}

export function estimateFee(feeRate: number, shares: number, price: number): number {
  return Math.round(feeRate * shares * price * (1 - price) * 100) / 100;
}
