import { ANALYSIS_INSTRUCTIONS, describe, toEvaluation } from "./analyze";
import { ready } from "./db";
import { fetchQuote } from "./markets";
import { openTrade, snapshotEquity } from "./paper";
import { assess } from "./scan";
import { loadSettings } from "./settings";
import type { Candidate, Market, Region, Settings, SignalRow } from "./types";

/**
 * Review path for running the AI step on a Claude subscription: a scheduled
 * Claude Code routine pulls unscored matches from /api/pending, judges them
 * with the same instructions the API path uses, and posts the results to
 * /api/evaluations. Everything after that (checks, paper trades) is shared
 * with the scanner.
 */

export const ROUTINE_TRIGGER = "claude-routine";

type PendingRow = SignalRow & { market: Market | null; summary: string | null };

interface Loaded {
  row: PendingRow;
  candidate: Candidate;
  resolved: boolean;
}

async function hydrate(rows: PendingRow[]): Promise<Loaded[]> {
  return Promise.all(
    rows
      .filter((r) => r.market)
      .map(async (row) => {
        const snap = row.market!;
        // Re-price at review time: an hour can pass between the scan and the review.
        const quote = await fetchQuote(row.venue, row.market_id);
        const market: Market = quote ? { ...snap, ask: quote.ask, bid: quote.bid, feeRate: quote.feeRate } : snap;
        const candidate: Candidate = {
          key: `${row.headline_id}|${row.venue}|${row.market_id}`,
          headline: {
            id: row.headline_id,
            region: row.region as Region,
            source: row.source,
            title: row.headline,
            link: row.headline_url,
            summary: row.summary ?? "",
            publishedAt: new Date(row.published_at ?? row.created_at).toISOString(),
          },
          market,
          score: Number(row.match_score),
          shared: [],
        };
        return { row, candidate, resolved: Boolean(quote?.payout) };
      }),
  );
}

export async function pendingForReview(limit: number) {
  const sql = await ready();
  const settings = await loadSettings();
  const rows = (await sql`
    SELECT s.*, h.summary FROM signals s
    LEFT JOIN headlines h ON h.id = s.headline_id
    WHERE s.verdict = 'WATCH' AND s.market IS NOT NULL
      AND s.published_at > now() - ${settings.maxNewsAgeHours} * interval '1 hour'
    ORDER BY s.published_at DESC
    LIMIT ${limit}`) as PendingRow[];
  const now = Date.now();
  const loaded = (await hydrate(rows)).filter((l) => !l.resolved);
  return {
    now: new Date(now).toISOString(),
    count: loaded.length,
    instructions: ANALYSIS_INSTRUCTIONS,
    respond_with: {
      method: "POST",
      path: "/api/evaluations",
      headers: { "content-type": "application/json", "x-passcode": "<same passcode>" },
      body: {
        evaluations: [
          {
            id: "<candidate id>",
            relevant: false,
            resolved_by_news: false,
            prob_outcome_0: 0.5,
            confidence: 0.5,
            already_priced: false,
            reasoning: "<one or two sentences>",
          },
        ],
      },
    },
    candidates: loaded.map((l) => describe(l.candidate, String(l.row.id), now)),
  };
}

export interface ReviewResult {
  received: number;
  scored: number;
  passes: number;
  tradesOpened: number;
  skipped: number;
  notes: string[];
}

export async function applyReview(raw: unknown): Promise<ReviewResult> {
  const items = Array.isArray(raw) ? (raw as Record<string, unknown>[]).filter((e) => e && typeof e === "object") : [];
  const result: ReviewResult = { received: items.length, scored: 0, passes: 0, tradesOpened: 0, skipped: 0, notes: [] };
  if (!items.length) return result;

  const sql = await ready();
  const settings: Settings = await loadSettings();
  const ids = [...new Set(items.map((e) => Number(e.id)).filter((n) => Number.isInteger(n) && n > 0))];
  const rows = (await sql`
    SELECT s.*, h.summary FROM signals s
    LEFT JOIN headlines h ON h.id = s.headline_id
    WHERE s.id = ANY(${ids}) AND s.verdict = 'WATCH'`) as PendingRow[];
  const byId = new Map((await hydrate(rows)).map((l) => [l.row.id, l]));

  const passes: { signalId: number; l: Loaded; a: ReturnType<typeof assess> }[] = [];
  for (const item of items) {
    const l = byId.get(Number(item.id));
    if (!l) {
      result.skipped++;
      continue;
    }
    byId.delete(l.row.id); // ignore duplicate ids in one batch
    const m = l.candidate.market;

    if (l.resolved) {
      await sql`UPDATE signals SET verdict = 'DROP', reasoning = 'Market resolved before review.' WHERE id = ${l.row.id} AND verdict = 'WATCH'`;
      result.skipped++;
      continue;
    }

    const ev = toEvaluation(item);
    const a = assess(l.candidate, ev, settings);
    const reasoning = `${ev.resolvedByNews ? "[Outcome reported] " : ""}${ev.reasoning}`;
    const updated = (await sql`
      UPDATE signals SET side = ${a.side}, side_label = ${a.side === null ? null : m.outcomes[a.side]},
        market_price = ${a.price}, fair_prob = ${a.fair}, edge = ${a.edge}, confidence = ${ev.confidence},
        reasoning = ${reasoning}, checks = ${JSON.stringify(a.checks)}::jsonb, verdict = ${a.verdict},
        market = ${JSON.stringify(m)}::jsonb
      WHERE id = ${l.row.id} AND verdict = 'WATCH'
      RETURNING id`) as { id: number }[];
    if (!updated.length) {
      result.skipped++;
      continue;
    }
    result.scored++;
    if (a.verdict === "PASS") passes.push({ signalId: l.row.id, l, a });
  }
  result.passes = passes.length;

  if (settings.autoTrade) {
    passes.sort((x, y) => (y.a.edge ?? 0) - (x.a.edge ?? 0));
    for (const p of passes.slice(0, settings.maxTradesPerScan)) {
      const m = p.l.candidate.market;
      try {
        await openTrade(
          {
            signalId: p.signalId,
            venue: m.venue,
            marketId: m.id,
            marketQuestion: m.question,
            marketUrl: m.url,
            side: p.a.side!,
            sideLabel: m.outcomes[p.a.side!],
            quote: { ask: m.ask, bid: m.bid, payout: null, feeRate: m.feeRate },
            stake: settings.stake,
            auto: true,
            note: p.l.candidate.headline.title,
          },
          settings,
        );
        result.tradesOpened++;
      } catch (err) {
        result.notes.push(`Auto-trade skipped: ${(err as Error).message}`);
      }
    }
    if (result.tradesOpened) await snapshotEquity(settings);
  }

  // Log the review as a scan row so it shows up on the Desk.
  await sql`INSERT INTO scans (trigger, finished_at, candidates, signals, passes, trades_opened, ai_used, notes)
            VALUES (${ROUTINE_TRIGGER}, now(), ${result.received}, ${result.scored}, ${result.passes},
                    ${result.tradesOpened}, true, ${result.notes.join("\n") || null})`;
  return result;
}
