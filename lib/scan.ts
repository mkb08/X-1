import { aiConfigured, analysisMode, evaluateCandidates } from "./analyze";
import { ready } from "./db";
import { fetchHeadlines, type FeedResult } from "./feeds";
import { fetchKalshi, fetchPolymarket, quoteFromMarket, type Quote } from "./markets";
import { matchHeadlines } from "./match";
import { markToMarket, openTrade, snapshotEquity } from "./paper";
import { loadSettings } from "./settings";
import type { Candidate, Check, Evaluation, Market, Settings, Verdict } from "./types";

export function minScanIntervalMs(): number {
  const n = Number(process.env.MIN_SCAN_INTERVAL_MIN);
  return (Number.isFinite(n) && n >= 1 ? n : 10) * 60_000;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}¢`;

function nyHour(iso: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" }).format(
    new Date(iso),
  );
  return Number(h);
}

export function isUsOvernight(iso: string): boolean {
  const h = nyHour(iso);
  return h >= 20 || h < 8;
}

function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m}m ago` : `${(m / 60).toFixed(1)}h ago`;
}

interface Assessed {
  checks: Check[];
  verdict: Verdict;
  side: number | null;
  price: number | null;
  fair: number | null;
  edge: number | null;
}

export function assess(c: Candidate, ev: Evaluation | undefined, s: Settings, now = Date.now()): Assessed {
  const m = c.market;
  const age = now - Date.parse(c.headline.publishedAt);
  const spread = Math.max(0, m.ask[0] - m.bid[0]);
  const closes = m.closesAt ? Date.parse(m.closesAt) : null;
  const checks: Check[] = [
    {
      name: "Fresh overseas news",
      pass: age <= s.maxNewsAgeHours * 3600_000,
      detail: `${c.headline.region} · ${c.headline.source} · ${ago(age)}${isUsOvernight(c.headline.publishedAt) ? " · during U.S. night" : ""}`,
    },
    {
      name: "Liquidity",
      pass: m.volume24h >= s.minVolume24h,
      detail: `$${Math.round(m.volume24h).toLocaleString("en-US")} traded 24h`,
    },
    { name: "Tight spread", pass: spread <= s.maxSpread + 1e-9, detail: `${(spread * 100).toFixed(1)}¢ bid/ask spread` },
    {
      name: "Resolves soon",
      pass: closes === null || closes <= now + s.maxDaysToClose * 86400_000,
      detail: closes === null ? "no close date" : closes < now ? "past close, awaiting result" : `closes in ${Math.ceil((closes - now) / 86400_000)}d`,
    },
  ];

  if (!ev) {
    const mode = analysisMode();
    checks.push({
      name: "AI analysis",
      pass: false,
      detail: mode === "routine" ? "waiting for the hourly Claude review" : mode === "api" ? "not evaluated this scan" : "add ANTHROPIC_API_KEY to enable",
    });
    return { checks, verdict: "WATCH", side: null, price: null, fair: null, edge: null };
  }

  const fair: [number, number] = [ev.probOutcome0, 1 - ev.probOutcome0];
  const edges: [number, number] = [fair[0] - m.ask[0], fair[1] - m.ask[1]];
  const side = edges[0] >= edges[1] ? 0 : 1;
  const edge = edges[side];

  checks.push(
    { name: "Directly relevant", pass: ev.relevant, detail: ev.resolvedByNews ? "news reports the deciding fact" : ev.relevant ? "moves this market" : "keyword coincidence" },
    { name: "Not yet repriced", pass: !ev.alreadyPriced, detail: ev.alreadyPriced ? "price already reflects it" : `market ${pct(m.ask[side])} vs fair ${pct(fair[side])}` },
    { name: `Edge ≥ ${pct(s.minEdge)}`, pass: edge >= s.minEdge, detail: `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)}¢ on ${m.outcomes[side]}` },
    { name: "Confidence", pass: ev.confidence >= s.minConfidence, detail: `${Math.round(ev.confidence * 100)}% (min ${Math.round(s.minConfidence * 100)}%)` },
  );

  return {
    checks,
    verdict: checks.every((ch) => ch.pass) ? "PASS" : "DROP",
    side,
    price: m.ask[side],
    fair: fair[side],
    edge,
  };
}

export interface ScanSummary {
  skipped?: string;
  nextAllowedAt?: string;
  scanId?: number;
  headlines?: number;
  markets?: number;
  candidates?: number;
  evaluated?: number;
  passes?: number;
  tradesOpened?: number;
  settled?: number;
  notes?: string[];
  error?: string;
}

async function upsertHeadlines(sql: Awaited<ReturnType<typeof ready>>, hs: Awaited<ReturnType<typeof fetchHeadlines>>["headlines"], matched: Map<string, number>) {
  if (!hs.length) return;
  await sql.query(
    `INSERT INTO headlines (id, region, source, title, link, summary, published_at, matched)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::timestamptz[], $8::int[])
     ON CONFLICT (id) DO UPDATE SET matched = GREATEST(headlines.matched, EXCLUDED.matched)`,
    [
      hs.map((h) => h.id),
      hs.map((h) => h.region),
      hs.map((h) => h.source),
      hs.map((h) => h.title),
      hs.map((h) => h.link),
      hs.map((h) => h.summary),
      hs.map((h) => h.publishedAt),
      hs.map((h) => matched.get(h.id) ?? 0),
    ],
  );
}

export async function runScan(trigger: string, force = false): Promise<ScanSummary> {
  const sql = await ready();
  const settings = await loadSettings();
  const now = Date.now();

  const [last] = (await sql`SELECT id, started_at, finished_at FROM scans WHERE trigger <> 'claude-routine' ORDER BY id DESC LIMIT 1`) as {
    id: number;
    started_at: string;
    finished_at: string | null;
  }[];
  if (last) {
    const startedMs = new Date(last.started_at).getTime();
    if (!last.finished_at && now - startedMs < 6 * 60_000) return { skipped: "A scan is already running." };
    if (!force && now - startedMs < minScanIntervalMs()) {
      return {
        skipped: "Scanned recently; waiting to protect your API budget.",
        nextAllowedAt: new Date(startedMs + minScanIntervalMs()).toISOString(),
      };
    }
  }

  const [{ id: scanId }] = (await sql`INSERT INTO scans (trigger) VALUES (${trigger}) RETURNING id`) as { id: number }[];
  const notes: string[] = [];

  try {
    const [newsR, polyR, kalshiR] = await Promise.allSettled([
      fetchHeadlines(settings.regions, settings.maxNewsAgeHours),
      fetchPolymarket(),
      fetchKalshi(settings.maxDaysToClose),
    ]);
    const headlines = newsR.status === "fulfilled" ? newsR.value.headlines : [];
    const feedResults: FeedResult[] = newsR.status === "fulfilled" ? newsR.value.results : [];
    const markets: Market[] = [];
    if (polyR.status === "fulfilled") markets.push(...polyR.value);
    else notes.push(`Polymarket unavailable: ${String(polyR.reason?.message ?? polyR.reason)}`);
    if (kalshiR.status === "fulfilled") markets.push(...kalshiR.value);
    else notes.push(`Kalshi unavailable: ${String(kalshiR.reason?.message ?? kalshiR.reason)}`);
    const failedFeeds = feedResults.filter((f) => !f.ok);
    if (failedFeeds.length) notes.push(`${failedFeeds.length} feed(s) failed: ${failedFeeds.map((f) => f.feed.source).join(", ")}`);

    // Match, then skip pairs that were already judged in an earlier scan.
    const allCandidates = matchHeadlines(headlines, markets);
    const matchedCount = new Map<string, number>();
    for (const c of allCandidates) matchedCount.set(c.headline.id, (matchedCount.get(c.headline.id) ?? 0) + 1);
    await upsertHeadlines(sql, headlines, matchedCount);

    const judged = new Set(
      (
        (await sql`SELECT headline_id || '|' || venue || '|' || market_id AS k FROM signals
                   WHERE verdict <> 'WATCH' AND headline_id = ANY(${[...matchedCount.keys()]})`) as { k: string }[]
      ).map((r) => r.k),
    );
    const fresh = allCandidates.filter((c) => !judged.has(c.key)).slice(0, settings.maxCandidatesPerScan);

    const { evaluations, errors } = await evaluateCandidates(fresh);
    notes.push(...errors);
    if (analysisMode() === "off") notes.push("ANTHROPIC_API_KEY is not set: candidates are listed as WATCH without AI scoring.");

    // Persist signals.
    const passes: { signalId: number; c: Candidate; a: ReturnType<typeof assess> }[] = [];
    for (const c of fresh) {
      const ev = evaluations.get(c.key);
      const a = assess(c, ev, settings, now);
      const reasoning = ev ? `${ev.resolvedByNews ? "[Outcome reported] " : ""}${ev.reasoning}` : null;
      const rows = (await sql`
        INSERT INTO signals (scan_id, headline_id, headline, headline_url, source, region, published_at, venue, market_id,
                             market_question, market_url, closes_at, side, side_label, market_price, fair_prob, edge,
                             confidence, match_score, reasoning, checks, verdict, market)
        VALUES (${scanId}, ${c.headline.id}, ${c.headline.title}, ${c.headline.link}, ${c.headline.source}, ${c.headline.region},
                ${c.headline.publishedAt}, ${c.market.venue}, ${c.market.id}, ${c.market.question}, ${c.market.url},
                ${c.market.closesAt}, ${a.side}, ${a.side === null ? null : c.market.outcomes[a.side]}, ${a.price}, ${a.fair},
                ${a.edge}, ${ev?.confidence ?? null}, ${c.score}, ${reasoning}, ${JSON.stringify(a.checks)}::jsonb, ${a.verdict},
                ${JSON.stringify(c.market)}::jsonb)
        ON CONFLICT (headline_id, venue, market_id) DO UPDATE SET
          scan_id = EXCLUDED.scan_id, created_at = now(), side = EXCLUDED.side, side_label = EXCLUDED.side_label,
          market_price = EXCLUDED.market_price, fair_prob = EXCLUDED.fair_prob, edge = EXCLUDED.edge,
          confidence = EXCLUDED.confidence, reasoning = EXCLUDED.reasoning, checks = EXCLUDED.checks, verdict = EXCLUDED.verdict,
          market = EXCLUDED.market
        WHERE signals.verdict = 'WATCH'
        RETURNING id`) as { id: number }[];
      if (a.verdict === "PASS" && rows[0]) passes.push({ signalId: rows[0].id, c, a });
    }

    // Auto paper-trade the best PASS signals.
    let tradesOpened = 0;
    if (settings.autoTrade) {
      passes.sort((x, y) => (y.a.edge ?? 0) - (x.a.edge ?? 0));
      for (const p of passes.slice(0, settings.maxTradesPerScan)) {
        try {
          await openTrade(
            {
              signalId: p.signalId,
              venue: p.c.market.venue,
              marketId: p.c.market.id,
              marketQuestion: p.c.market.question,
              marketUrl: p.c.market.url,
              side: p.a.side!,
              sideLabel: p.c.market.outcomes[p.a.side!],
              quote: quoteFromMarket(p.c.market),
              stake: settings.stake,
              auto: true,
              note: p.c.headline.title,
            },
            settings,
          );
          tradesOpened++;
        } catch (err) {
          notes.push(`Auto-trade skipped: ${(err as Error).message}`);
        }
      }
    }

    // Re-price open positions and settle resolved ones, then record equity.
    const known = new Map<string, Quote>(markets.map((m) => [`${m.venue}|${m.id}`, quoteFromMarket(m)]));
    const mtm = await markToMarket(known);
    await snapshotEquity(settings);

    // Housekeeping: keep the tables small.
    await sql`DELETE FROM headlines WHERE published_at < now() - interval '3 days'`;
    await sql`DELETE FROM signals WHERE verdict <> 'PASS' AND created_at < now() - interval '7 days'
              AND id NOT IN (SELECT signal_id FROM trades WHERE signal_id IS NOT NULL)`;

    await sql`UPDATE scans SET finished_at = now(), headlines = ${headlines.length}, markets = ${markets.length},
              candidates = ${allCandidates.length}, signals = ${fresh.length}, passes = ${passes.length},
              trades_opened = ${tradesOpened}, ai_used = ${evaluations.size > 0},
              feeds = ${JSON.stringify(feedResults.map((f) => ({ source: f.feed.source, region: f.feed.region, ok: f.ok, count: f.count, error: f.error ?? null })))}::jsonb,
              notes = ${notes.join("\n") || null}
              WHERE id = ${scanId}`;

    return {
      scanId,
      headlines: headlines.length,
      markets: markets.length,
      candidates: allCandidates.length,
      evaluated: evaluations.size,
      passes: passes.length,
      tradesOpened,
      settled: mtm.settled,
      notes,
    };
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    await sql`UPDATE scans SET finished_at = now(), error = ${message}, notes = ${notes.join("\n") || null} WHERE id = ${scanId}`;
    return { scanId, error: message, notes };
  }
}
