import Anthropic from "@anthropic-ai/sdk";
import type { Candidate, Evaluation } from "./types";

export const DEFAULT_MODEL = "claude-opus-5-5";
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type Effort = (typeof EFFORTS)[number];

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiModel(): string {
  return process.env.ANALYSIS_MODEL || DEFAULT_MODEL;
}

function aiEffort(): Effort {
  const e = process.env.ANALYSIS_EFFORT as Effort | undefined;
  return e && EFFORTS.includes(e) ? e : "medium";
}

const SYSTEM = `You are the analysis desk for a news-latency scanner.

Each candidate pairs a headline from an overseas outlet (Japan, Asia, Europe, Australia, Middle East) with a prediction market on a U.S.-accessible venue (Kalshi or Polymarket). The pair was found by keyword overlap, so most pairs are coincidences.

For every candidate, return:
- relevant: true only if the news directly changes the probability of how THIS market resolves, judged against its question and rules. Same topic but a different question is not relevant.
- resolved_by_news: true only if the news reports the deciding fact itself (an official result, a final score, an announced decision) so the outcome is effectively known.
- prob_outcome_0: your probability, from 0 to 1, that the market resolves to outcome 0 (named in the candidate), taking the news into account. Be calibrated. If the pair is not relevant, return the current market mid.
- confidence: from 0 to 1, how much you trust that estimate given only the information provided.
- already_priced: true if the current price already reflects this news (the price is already near your estimate, or the story is old or widely known).
- reasoning: one or two short, concrete sentences.

Use only the headline, its summary, the market text, and well-established background knowledge. Do not invent facts. Opinion, analysis, previews and speculation are not resolution. A deciding fact reported by a single outlet deserves lower confidence. Return one evaluation per candidate id.`;

const SCHEMA = {
  type: "object",
  properties: {
    evaluations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevant: { type: "boolean" },
          resolved_by_news: { type: "boolean" },
          prob_outcome_0: { type: "number" },
          confidence: { type: "number" },
          already_priced: { type: "boolean" },
          reasoning: { type: "string" },
        },
        required: ["id", "relevant", "resolved_by_news", "prob_outcome_0", "confidence", "already_priced", "reasoning"],
        additionalProperties: false,
      },
    },
  },
  required: ["evaluations"],
  additionalProperties: false,
};

const clamp01 = (n: unknown) => Math.min(1, Math.max(0, Number(n) || 0));
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function describe(c: Candidate, idx: number, now: number) {
  const m = c.market;
  const mid = (m.bid[0] + m.ask[0]) / 2;
  return {
    id: String(idx),
    headline: {
      title: c.headline.title,
      summary: c.headline.summary.slice(0, 300),
      source: c.headline.source,
      region: c.headline.region,
      published_utc: c.headline.publishedAt,
      age_minutes: Math.round((now - Date.parse(c.headline.publishedAt)) / 60000),
    },
    market: {
      venue: m.venue,
      question: m.question,
      context: m.context,
      rules: m.rules.slice(0, 350),
      outcome_0: m.outcomes[0],
      outcome_1: m.outcomes[1],
      mid_price_outcome_0: round3(mid),
      ask_outcome_0: round3(m.ask[0]),
      ask_outcome_1: round3(m.ask[1]),
      closes_utc: m.closesAt,
    },
  };
}

export async function evaluateChunk(client: Anthropic, chunk: Candidate[], offset: number): Promise<Map<string, Evaluation>> {
  const now = Date.now();
  const model = aiModel();
  const payload = chunk.map((c, i) => describe(c, offset + i, now));
  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: aiEffort(), format: { type: "json_schema", schema: SCHEMA } },
    ...(FALLBACK_MODELS.has(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    messages: [
      {
        role: "user",
        content: `Current time (UTC): ${new Date(now).toISOString()}\n\nCandidates:\n${JSON.stringify(payload, null, 1)}`,
      },
    ],
  });

  const out = new Map<string, Evaluation>();
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return out;
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return out;
  let parsed: { evaluations?: Record<string, unknown>[] };
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    return out;
  }
  for (const e of parsed.evaluations ?? []) {
    const idx = Number(e.id) - offset;
    const cand = chunk[idx];
    if (!cand) continue;
    out.set(cand.key, {
      relevant: Boolean(e.relevant),
      resolvedByNews: Boolean(e.resolved_by_news),
      probOutcome0: clamp01(e.prob_outcome_0),
      confidence: clamp01(e.confidence),
      alreadyPriced: Boolean(e.already_priced),
      reasoning: String(e.reasoning ?? "").slice(0, 600),
    });
  }
  return out;
}

/** Ask Claude to judge each headline/market pair. Returns evaluations keyed by candidate key. */
export async function evaluateCandidates(
  candidates: Candidate[],
): Promise<{ evaluations: Map<string, Evaluation>; errors: string[] }> {
  const evaluations = new Map<string, Evaluation>();
  const errors: string[] = [];
  if (!candidates.length || !aiConfigured()) return { evaluations, errors };

  // Identity-linked keys (not tied to one workspace) must name the workspace on every request.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = new Anthropic({
    maxRetries: 2,
    timeout: 240_000,
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
  });
  const size = 12;
  const chunks: [Candidate[], number][] = [];
  for (let i = 0; i < candidates.length; i += size) chunks.push([candidates.slice(i, i + size), i]);

  const results = await Promise.allSettled(chunks.map(([chunk, offset]) => evaluateChunk(client, chunk, offset)));
  for (const r of results) {
    if (r.status === "fulfilled") r.value.forEach((v, k) => evaluations.set(k, v));
    else if (r.reason instanceof Anthropic.AuthenticationError) errors.push("Anthropic API key was rejected (401).");
    else if (r.reason instanceof Anthropic.RateLimitError) errors.push("Anthropic rate limit hit (429); will retry next scan.");
    else if (r.reason instanceof Anthropic.APIError) {
      const body = r.reason.error as { error?: { message?: string } } | undefined;
      const msg = body?.error?.message ?? r.reason.message;
      errors.push(
        /credit balance/i.test(msg)
          ? "Anthropic account is out of API credits: add credits at platform.claude.com → Plans & Billing."
          : `Anthropic API error ${r.reason.status ?? ""}: ${msg}`.slice(0, 300),
      );
    }
    else errors.push(String(r.reason?.message ?? r.reason).slice(0, 300));
  }
  return { evaluations, errors: [...new Set(errors)] };
}
