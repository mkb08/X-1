import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { Headline, Region } from "./types";

export interface FeedSource {
  region: Region;
  source: string;
  url: string;
}

/**
 * Overseas sources only. The whole point is to read news that breaks while
 * U.S. traders are asleep, so no U.S. outlets are included.
 */
export const FEEDS: FeedSource[] = [
  { region: "Japan", source: "Japan Times", url: "https://www.japantimes.co.jp/feed/" },
  { region: "Japan", source: "Nikkei Asia", url: "https://asia.nikkei.com/rss/feed/nar" },
  { region: "Asia", source: "South China Morning Post", url: "https://www.scmp.com/rss/91/feed" },
  { region: "Asia", source: "Straits Times", url: "https://www.straitstimes.com/news/asia/rss.xml" },
  { region: "Asia", source: "Mint Markets", url: "https://www.livemint.com/rss/markets" },
  { region: "Europe", source: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
  { region: "Europe", source: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { region: "Europe", source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/rss.xml" },
  { region: "Europe", source: "DW Business", url: "https://rss.dw.com/rdf/rss-en-bus" },
  { region: "Europe", source: "Guardian Business", url: "https://www.theguardian.com/business/rss" },
  { region: "Europe", source: "Euronews Business", url: "https://www.euronews.com/rss?level=theme&name=business" },
  { region: "Europe", source: "Sky News Business", url: "https://feeds.skynews.com/feeds/rss/business.xml" },
  { region: "Europe", source: "Financial Times", url: "https://www.ft.com/rss/home/international" },
  { region: "Australia", source: "ABC News", url: "https://www.abc.net.au/news/feed/51892/rss.xml" },
  { region: "Australia", source: "Sydney Morning Herald", url: "https://www.smh.com.au/rss/business.xml" },
  { region: "Middle East", source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { region: "Middle East", source: "The National", url: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml" },
  { region: "Middle East", source: "Gulf News", url: "https://gulfnews.com/feed" },
  // Aggregator last, so a direct publisher's copy of the same story wins de-duplication.
  {
    region: "Australia",
    source: "Google News AU",
    url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-AU&gl=AU&ceid=AU:en",
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
});

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("#text" in o) return text(o["#text"]);
    if ("@_href" in o) return text(o["@_href"]);
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function headlineId(link: string, title: string): string {
  return createHash("sha1").update(link || title).digest("hex").slice(0, 16);
}

export function parseFeed(xml: string, feed: FeedSource): Headline[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const items: any[] = [
    ...asArray(doc?.rss?.channel?.item),
    ...asArray(doc?.["rdf:RDF"]?.item),
    ...asArray(doc?.feed?.entry),
  ];
  const out: Headline[] = [];
  const isGoogle = feed.url.includes("news.google.com");
  for (const it of items) {
    let title = stripHtml(text(it.title));
    let source = feed.source;
    // Google News appends " - Publisher"; move it into the source so duplicates collapse.
    const cut = isGoogle ? title.lastIndexOf(" - ") : -1;
    if (cut > 0) {
      source = `${title.slice(cut + 3)} via Google News`;
      title = title.slice(0, cut);
    }
    if (!title) continue;
    const rawLink = (text(it.link) || text(it.guid) || text(it.id)).trim();
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : "";
    const rawDate = text(it.pubDate) || text(it["dc:date"]) || text(it.published) || text(it.updated);
    const ts = rawDate ? Date.parse(rawDate) : NaN;
    if (!Number.isFinite(ts)) continue;
    const summary = stripHtml(text(it.description) || text(it.summary) || text(it["content:encoded"])).slice(0, 400);
    out.push({
      id: headlineId(link, title),
      region: feed.region,
      source,
      title,
      link,
      summary,
      publishedAt: new Date(ts).toISOString(),
    });
  }
  return out;
}

export interface FeedResult {
  feed: FeedSource;
  ok: boolean;
  count: number;
  error?: string;
}

export async function fetchHeadlines(
  regions: Region[],
  maxAgeHours: number,
): Promise<{ headlines: Headline[]; results: FeedResult[] }> {
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  const feeds = FEEDS.filter((f) => regions.includes(f.region));
  const settled = await Promise.allSettled(
    feeds.map(async (feed) => {
      const res = await fetch(feed.url, {
        headers: { "user-agent": "Mozilla/5.0 (compatible; NewsReader/1.0; +https://vercel.com)", accept: "application/rss+xml, application/xml, text/xml, */*" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseFeed(await res.text(), feed);
    }),
  );

  const seen = new Set<string>();
  const headlines: Headline[] = [];
  const results: FeedResult[] = [];
  settled.forEach((r, i) => {
    const feed = feeds[i];
    if (r.status === "rejected") {
      results.push({ feed, ok: false, count: 0, error: String(r.reason?.message ?? r.reason) });
      return;
    }
    let count = 0;
    for (const h of r.value) {
      if (Date.parse(h.publishedAt) < cutoff || Date.parse(h.publishedAt) > Date.now() + 3600_000) continue;
      const titleKey = h.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (seen.has(h.id) || seen.has(titleKey)) continue;
      seen.add(h.id);
      seen.add(titleKey);
      headlines.push(h);
      count++;
    }
    results.push({ feed, ok: true, count });
  });
  headlines.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { headlines, results };
}
