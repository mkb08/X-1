export type Region = "Japan" | "Asia" | "Europe" | "Australia" | "Middle East";

export type Venue = "polymarket" | "kalshi";

export interface Headline {
  id: string;
  region: Region;
  source: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: string; // ISO
}

/** A two-outcome market. Prices are probabilities in [0, 1]. */
export interface Market {
  venue: Venue;
  id: string;
  group: string; // event the market belongs to (sibling strikes / candidates share it)
  question: string;
  context: string; // extra matching text: event title, sub-titles
  outcomes: [string, string];
  ask: [number, number]; // price to buy outcome 0 / outcome 1
  bid: [number, number]; // price to sell outcome 0 / outcome 1
  volume24h: number; // USD
  liquidity: number; // USD (open interest on Kalshi)
  closesAt: string | null;
  url: string;
  rules: string;
  feeRate: number; // fee = feeRate * shares * p * (1 - p)
}

export interface Candidate {
  key: string; // `${headline.id}|${venue}|${market.id}`
  headline: Headline;
  market: Market;
  score: number;
  shared: string[];
}

export interface Evaluation {
  relevant: boolean;
  resolvedByNews: boolean;
  probOutcome0: number;
  confidence: number;
  alreadyPriced: boolean;
  reasoning: string;
}

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export type Verdict = "PASS" | "DROP" | "WATCH";

export interface Settings {
  autoTrade: boolean;
  stake: number;
  startingBankroll: number;
  minEdge: number;
  minConfidence: number;
  maxNewsAgeHours: number;
  maxDaysToClose: number;
  minVolume24h: number;
  maxSpread: number;
  maxTradesPerScan: number;
  maxCandidatesPerScan: number;
  regions: Region[];
}

export interface SignalRow {
  id: number;
  scan_id: number;
  created_at: string;
  headline_id: string;
  headline: string;
  headline_url: string;
  source: string;
  region: string;
  published_at: string | null;
  venue: Venue;
  market_id: string;
  market_question: string;
  market_url: string;
  closes_at: string | null;
  side: number | null;
  side_label: string | null;
  market_price: number | null;
  fair_prob: number | null;
  edge: number | null;
  confidence: number | null;
  match_score: number;
  reasoning: string | null;
  checks: Check[];
  verdict: Verdict;
}

export interface TradeRow {
  id: number;
  signal_id: number | null;
  opened_at: string;
  venue: Venue;
  market_id: string;
  market_question: string;
  market_url: string;
  side: number;
  side_label: string;
  entry_price: number;
  shares: number;
  stake: number;
  fees: number;
  fee_rate: number;
  status: "open" | "closed" | "settled";
  mark_price: number | null;
  marked_at: string | null;
  exit_price: number | null;
  closed_at: string | null;
  pnl: number | null;
  auto: boolean;
  note: string | null;
}

export interface ScanRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  headlines: number;
  markets: number;
  candidates: number;
  signals: number;
  passes: number;
  trades_opened: number;
  ai_used: boolean;
  notes: string | null;
  error: string | null;
}
