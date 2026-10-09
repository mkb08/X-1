import { ready } from "./db";
import { estimateFee, fetchQuote, type Quote } from "./markets";
import type { Settings, TradeRow, Venue } from "./types";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface Portfolio {
  bankroll: number;
  cash: number;
  realized: number;
  unrealized: number;
  equity: number;
  openPositions: number;
  closedTrades: number;
  wins: number;
  losses: number;
}

export async function portfolio(settings: Settings): Promise<Portfolio> {
  const sql = await ready();
  const [row] = (await sql`
    SELECT
      COALESCE(SUM(pnl) FILTER (WHERE status <> 'open'), 0) AS realized,
      COALESCE(SUM(shares * COALESCE(mark_price, entry_price) - stake - fees) FILTER (WHERE status = 'open'), 0) AS unrealized,
      COALESCE(SUM(stake + fees) FILTER (WHERE status = 'open'), 0) AS committed,
      COUNT(*) FILTER (WHERE status = 'open') AS open_positions,
      COUNT(*) FILTER (WHERE status <> 'open') AS closed_trades,
      COUNT(*) FILTER (WHERE status <> 'open' AND pnl > 0) AS wins,
      COUNT(*) FILTER (WHERE status <> 'open' AND pnl <= 0) AS losses
    FROM trades`) as Record<string, string | number>[];
  const realized = Number(row.realized);
  const unrealized = Number(row.unrealized);
  return {
    bankroll: settings.startingBankroll,
    cash: round2(settings.startingBankroll + realized - Number(row.committed)),
    realized: round2(realized),
    unrealized: round2(unrealized),
    equity: round2(settings.startingBankroll + realized + unrealized),
    openPositions: Number(row.open_positions),
    closedTrades: Number(row.closed_trades),
    wins: Number(row.wins),
    losses: Number(row.losses),
  };
}

export interface OpenTradeInput {
  signalId: number | null;
  venue: Venue;
  marketId: string;
  marketQuestion: string;
  marketUrl: string;
  side: number;
  sideLabel: string;
  quote: Quote;
  stake: number;
  auto: boolean;
  note?: string;
}

export async function openTrade(input: OpenTradeInput, settings: Settings): Promise<TradeRow> {
  const sql = await ready();
  const price = input.quote.ask[input.side];
  if (!(price > 0 && price < 1)) throw new Error("No tradable ask price for this outcome right now.");

  const dup = (await sql`SELECT id FROM trades WHERE status = 'open' AND venue = ${input.venue} AND market_id = ${input.marketId} LIMIT 1`) as unknown[];
  if (dup.length) throw new Error("There is already an open paper position on this market.");

  const p = await portfolio(settings);
  const shares = input.stake / price;
  const fees = estimateFee(input.quote.feeRate, shares, price);
  if (p.cash < input.stake + fees) throw new Error(`Not enough paper cash ($${p.cash.toFixed(2)} available).`);

  const [row] = (await sql`
    INSERT INTO trades (signal_id, venue, market_id, market_question, market_url, side, side_label,
                        entry_price, shares, stake, fees, fee_rate, mark_price, marked_at, auto, note)
    VALUES (${input.signalId}, ${input.venue}, ${input.marketId}, ${input.marketQuestion}, ${input.marketUrl},
            ${input.side}, ${input.sideLabel}, ${price}, ${shares}, ${input.stake}, ${fees}, ${input.quote.feeRate},
            ${input.quote.bid[input.side]}, now(), ${input.auto}, ${input.note ?? null})
    RETURNING *`) as TradeRow[];
  return row;
}

export async function closeTrade(id: number): Promise<TradeRow> {
  const sql = await ready();
  const [t] = (await sql`SELECT * FROM trades WHERE id = ${id}`) as TradeRow[];
  if (!t) throw new Error("Trade not found.");
  if (t.status !== "open") throw new Error("Trade is already closed.");
  const quote = await fetchQuote(t.venue, t.market_id);
  if (!quote) throw new Error("Could not fetch a live price to close at. Try again in a minute.");
  if (quote.payout) return settleTrade(t, quote.payout);
  const exit = quote.bid[t.side];
  const exitFee = estimateFee(Number(t.fee_rate ?? 0), t.shares, exit);
  const pnl = round2(t.shares * exit - t.stake - t.fees - exitFee);
  const [row] = (await sql`
    UPDATE trades SET status = 'closed', exit_price = ${exit}, closed_at = now(), pnl = ${pnl},
                      fees = fees + ${exitFee}, mark_price = ${exit}, marked_at = now()
    WHERE id = ${id} AND status = 'open' RETURNING *`) as TradeRow[];
  return row;
}

async function settleTrade(t: TradeRow, payout: [number, number]): Promise<TradeRow> {
  const sql = await ready();
  const exit = payout[t.side];
  const pnl = round2(t.shares * exit - t.stake - t.fees);
  const [row] = (await sql`
    UPDATE trades SET status = 'settled', exit_price = ${exit}, closed_at = now(), pnl = ${pnl},
                      mark_price = ${exit}, marked_at = now()
    WHERE id = ${t.id} AND status = 'open' RETURNING *`) as TradeRow[];
  return row ?? t;
}

/**
 * Re-price every open position. Uses quotes already fetched during the scan
 * when available and falls back to a direct lookup (which also detects
 * resolution, since resolved markets drop out of the open-market lists).
 */
export async function markToMarket(known: Map<string, Quote>): Promise<{ marked: number; settled: number }> {
  const sql = await ready();
  const open = (await sql`SELECT * FROM trades WHERE status = 'open'`) as TradeRow[];
  let marked = 0;
  let settled = 0;
  await Promise.all(
    open.map(async (t) => {
      const quote = known.get(`${t.venue}|${t.market_id}`) ?? (await fetchQuote(t.venue, t.market_id));
      if (!quote) return;
      if (quote.payout) {
        await settleTrade(t, quote.payout);
        settled++;
        return;
      }
      await sql`UPDATE trades SET mark_price = ${quote.bid[t.side]}, marked_at = now() WHERE id = ${t.id} AND status = 'open'`;
      marked++;
    }),
  );
  return { marked, settled };
}

export async function snapshotEquity(settings: Settings): Promise<void> {
  const sql = await ready();
  const p = await portfolio(settings);
  await sql`INSERT INTO equity (equity, realized, unrealized, open_positions)
            VALUES (${p.equity}, ${p.realized}, ${p.unrealized}, ${p.openPositions})`;
}
