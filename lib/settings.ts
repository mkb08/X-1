import { ready } from "./db";
import type { Region, Settings } from "./types";

export const ALL_REGIONS: Region[] = ["Japan", "Asia", "Europe", "Australia", "Middle East"];

export const DEFAULT_SETTINGS: Settings = {
  autoTrade: true,
  stake: 100,
  startingBankroll: 10_000,
  minEdge: 0.08,
  minConfidence: 0.6,
  maxNewsAgeHours: 8,
  maxDaysToClose: 45,
  minVolume24h: 500,
  maxSpread: 0.1,
  maxTradesPerScan: 5,
  maxCandidatesPerScan: 30,
  regions: ALL_REGIONS,
};

const LIMITS: Partial<Record<keyof Settings, [number, number]>> = {
  stake: [1, 100_000],
  startingBankroll: [100, 10_000_000],
  minEdge: [0, 0.5],
  minConfidence: [0, 1],
  maxNewsAgeHours: [1, 48],
  maxDaysToClose: [1, 365],
  minVolume24h: [0, 10_000_000],
  maxSpread: [0.01, 1],
  maxTradesPerScan: [0, 50],
  maxCandidatesPerScan: [1, 60],
};

export function sanitizeSettings(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = input[key];
    if (v === undefined) continue;
    if (key === "autoTrade") out.autoTrade = Boolean(v);
    else if (key === "regions") {
      if (Array.isArray(v)) out.regions = ALL_REGIONS.filter((r) => (v as string[]).includes(r));
    } else {
      const n = Number(v);
      const lim = LIMITS[key];
      if (Number.isFinite(n) && lim) (out as unknown as Record<string, number>)[key] = Math.min(lim[1], Math.max(lim[0], n));
    }
  }
  return out;
}

export async function loadSettings(): Promise<Settings> {
  const sql = await ready();
  const rows = (await sql`SELECT value FROM settings WHERE key = 'app'`) as { value: Partial<Settings> }[];
  return sanitizeSettings(rows[0]?.value ?? {});
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = sanitizeSettings(patch, current);
  const sql = await ready();
  await sql`INSERT INTO settings (key, value) VALUES ('app', ${JSON.stringify(next)}::jsonb)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  return next;
}
