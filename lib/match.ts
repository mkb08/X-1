import type { Candidate, Headline, Market } from "./types";

const STOP = new Set(
  (
    "the and for with from that this these those into onto over under about above below after before " +
    "amid against between during while than then there their them they his her hers its it's our your " +
    "you are was were been being has have had not but nor yet can could would should may might must will " +
    "shall who whom whose what which when where why how all any each both few more most other some such " +
    "only own same too very just also still even ever back near nearly via per out off again further once " +
    "here new news live update updates latest report reports say says said told tell amid make made take " +
    "takes set sets get gets got one two three four five six seven eight nine ten first last next top high " +
    "higher low lower record rise rises rising fall falls falling hit hits reach reaches end ends ending win " +
    "wins won winner market markets price prices percent cent yes year years month months week weeks day days " +
    "today tomorrow yesterday time times people world global big major key amid ahead look looks show shows " +
    "january february march april june july august september october november december " +
    "jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday " +
    "least many much less like likely unlikely within without around across among because since until upon " +
    "according following following including says' video watch photos opinion analysis explainer"
  ).split(/\s+/),
);

function stem(t: string): string {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) return t.slice(0, -1);
  return t;
}

export function tokenize(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t))
    .map(stem)
    .filter((t) => !STOP.has(t));
}

export interface MatchOptions {
  perHeadline: number;
  minScore: number;
  minRareIdf: number;
}

const DEFAULTS: MatchOptions = { perHeadline: 3, minScore: 9, minRareIdf: 4.5 };

/**
 * Pair overseas headlines with markets by shared rare terms (IDF-weighted over
 * the market universe). This is a cheap pre-filter; the AI step decides relevance.
 */
export function matchHeadlines(headlines: Headline[], markets: Market[], opts: Partial<MatchOptions> = {}): Candidate[] {
  const o = { ...DEFAULTS, ...opts };
  const N = markets.length || 1;
  const marketTokens = markets.map((m) => new Set(tokenize(`${m.question} ${m.context}`)));

  const df = new Map<string, number>();
  const index = new Map<string, number[]>();
  marketTokens.forEach((set, i) => {
    for (const t of set) {
      df.set(t, (df.get(t) ?? 0) + 1);
      let list = index.get(t);
      if (!list) index.set(t, (list = []));
      list.push(i);
    }
  });
  const idf = (t: string) => Math.log(N / (1 + (df.get(t) ?? 0))) + 1;

  const out: Candidate[] = [];
  for (const h of headlines) {
    const titleTokens = new Set(tokenize(h.title));
    const summaryTokens = new Set(tokenize(h.summary.slice(0, 300)));
    const weights = new Map<string, number>();
    for (const t of titleTokens) weights.set(t, 1);
    for (const t of summaryTokens) if (!weights.has(t)) weights.set(t, 0.4);

    const scores = new Map<number, { score: number; shared: string[]; titleShared: number; rare: boolean }>();
    for (const [t, w] of weights) {
      const list = index.get(t);
      if (!list) continue;
      // A term that appears in a large share of markets carries no signal.
      if (list.length > N * 0.05 && list.length > 25) continue;
      const v = idf(t);
      for (const i of list) {
        let s = scores.get(i);
        if (!s) scores.set(i, (s = { score: 0, shared: [], titleShared: 0, rare: false }));
        s.score += v * w;
        s.shared.push(t);
        if (w === 1) {
          s.titleShared++;
          if (v >= o.minRareIdf) s.rare = true;
        }
      }
    }

    // Best market per event (sibling strikes share most terms), then the top few events.
    const bestPerGroup = new Map<string, [number, { score: number; shared: string[] }]>();
    for (const [i, s] of scores) {
      if (!s.rare || s.score < o.minScore) continue;
      if (s.titleShared < 2 && s.shared.length < 3) continue;
      const g = `${markets[i].venue}:${markets[i].group}`;
      const prev = bestPerGroup.get(g);
      const informative = (k: number) => -Math.abs(markets[k].ask[0] - 0.5);
      if (!prev || s.score > prev[1].score || (s.score === prev[1].score && informative(i) > informative(prev[0]))) {
        bestPerGroup.set(g, [i, s]);
      }
    }
    const ranked = [...bestPerGroup.values()].sort((a, b) => b[1].score - a[1].score).slice(0, o.perHeadline);

    for (const [i, s] of ranked) {
      const m = markets[i];
      out.push({
        key: `${h.id}|${m.venue}|${m.id}`,
        headline: h,
        market: m,
        score: Math.round(s.score * 10) / 10,
        shared: s.shared,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
