"use client";

import { useEffect, useState } from "react";
import { api, getPasscode, setPasscode } from "@/lib/client";
import type { Region, Settings } from "@/lib/types";
import type { AppState } from "./shared";

const REGIONS: Region[] = ["Japan", "Asia", "Europe", "Australia", "Middle East"];

type NumKey = Exclude<keyof Settings, "autoTrade" | "regions">;

const FIELDS: { key: NumKey; label: string; hint: string; scale?: number; step?: number }[] = [
  { key: "stake", label: "Stake per trade ($)", hint: "Paper dollars per position" },
  { key: "startingBankroll", label: "Starting bankroll ($)", hint: "Equity baseline" },
  { key: "minEdge", label: "Min edge (¢)", hint: "Fair value minus ask", scale: 100 },
  { key: "minConfidence", label: "Min confidence (%)", hint: "Claude's confidence floor", scale: 100 },
  { key: "maxNewsAgeHours", label: "Max news age (h)", hint: "Older headlines are ignored" },
  { key: "maxDaysToClose", label: "Max days to close", hint: "Skip long-dated markets" },
  { key: "minVolume24h", label: "Min 24h volume ($)", hint: "Liquidity floor" },
  { key: "maxSpread", label: "Max spread (¢)", hint: "Bid/ask width", scale: 100 },
  { key: "maxTradesPerScan", label: "Max trades per scan", hint: "Auto-trade cap" },
  { key: "maxCandidatesPerScan", label: "Max AI checks per scan", hint: "Caps API cost per scan" },
];

export function SettingsTab({ state, onSaved, toast }: { state: AppState; onSaved: () => void; toast: (m: string) => void }) {
  const [draft, setDraft] = useState<Settings | null>(state.settings ?? null);
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (state.settings) setDraft(state.settings);
  }, [state.settings]);
  useEffect(() => setCode(getPasscode()), []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      await api("/api/settings", { method: "POST", body: draft });
      toast("Settings saved.");
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
    setSaving(false);
  }

  async function reset() {
    if (!confirm("Reset the paper account? This deletes all paper trades and the equity curve. Signals and news are kept.")) return;
    try {
      await api("/api/reset", { method: "POST", body: { confirm: "RESET" } });
      toast("Paper account reset.");
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const cfg = state.config;
  return (
    <>
      <section className="panel">
        <h2>System status</h2>
        <div className="list-row">
          <span>Database</span>
          <span className={cfg.database ? "pos" : "neg"}>{cfg.database ? "connected" : "missing DATABASE_URL"}</span>
        </div>
        <div className="list-row">
          <span>AI analysis</span>
          <span className={cfg.ai ? "pos" : "neg"}>{cfg.ai ? cfg.model : "missing ANTHROPIC_API_KEY"}</span>
        </div>
        <div className="list-row">
          <span>Passcode lock</span>
          <span className={cfg.passcode ? "pos" : "dim"}>{cfg.passcode ? "on" : "off (set APP_PASSCODE)"}</span>
        </div>
        <div className="list-row">
          <span>Min time between scans</span>
          <span>{cfg.minScanIntervalMin} min</span>
        </div>
      </section>

      {cfg.passcode && (
        <section className="panel">
          <h2>Passcode</h2>
          <div className="field">
            <div>
              <label htmlFor="pc">This device&apos;s passcode</label>
              <div className="hint">Needed to change settings or trade</div>
            </div>
            <input
              id="pc"
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onBlur={() => {
                setPasscode(code);
                toast("Passcode stored on this device.");
              }}
            />
          </div>
        </section>
      )}

      {draft && (
        <section className="panel">
          <h2>Strategy</h2>
          <div className="field">
            <div>
              <label>Auto paper-trade PASS signals</label>
              <div className="hint">Opens positions while you sleep</div>
            </div>
            <button
              className={`toggle ${draft.autoTrade ? "on" : ""}`}
              aria-pressed={draft.autoTrade}
              aria-label="Auto paper-trade"
              onClick={() => setDraft({ ...draft, autoTrade: !draft.autoTrade })}
            />
          </div>
          {FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <div>
                <label htmlFor={f.key}>{f.label}</label>
                <div className="hint">{f.hint}</div>
              </div>
              <input
                id={f.key}
                type="number"
                inputMode="decimal"
                value={Math.round(Number(draft[f.key]) * (f.scale ?? 1) * 100) / 100}
                onChange={(e) => setDraft({ ...draft, [f.key]: Number(e.target.value) / (f.scale ?? 1) })}
              />
            </div>
          ))}
          <div className="field" style={{ display: "block" }}>
            <label>Regions to scan</label>
            <div className="chips" style={{ marginTop: 8, marginBottom: 0, flexWrap: "wrap" }}>
              {REGIONS.map((r) => {
                const on = draft.regions.includes(r);
                return (
                  <button
                    key={r}
                    className={`chip ${on ? "active" : ""}`}
                    onClick={() => setDraft({ ...draft, regions: on ? draft.regions.filter((x) => x !== r) : [...draft.regions, r] })}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </section>
      )}

      <section className="panel">
        <h2>How this works</h2>
        <div className="prose">
          <p>
            <strong>The idea from the post:</strong> news breaks in Tokyo, Sydney, Dubai or London while U.S. traders sleep. If a U.S.
            prediction market hasn&apos;t repriced yet, there may be a gap between what&apos;s already known overseas and the market price.
          </p>
          <p>
            <strong>What the scanner does:</strong> every 30 minutes it reads about 19 overseas news feeds, matches headlines to open Kalshi
            and Polymarket markets by shared names and terms, and asks Claude whether each headline actually moves that specific
            market. A signal is <strong>PASS</strong> only when the news is fresh, the market is liquid with a tight spread, it resolves
            soon, Claude rates it relevant and not yet priced in, and the edge and confidence clear your thresholds.
          </p>
          <p>
            <strong>Paper only.</strong> Every trade here is simulated at the real ask price, including estimated venue fees, and marked
            to the real bid. Let it run for at least 24 hours (ideally a couple of weeks) before drawing conclusions. Most nights it will
            find nothing, and that&apos;s the honest result.
          </p>
          <p className="small">
            Not financial advice. Prediction-market access depends on where you live: Polymarket&apos;s main exchange restricts U.S.
            users, while Kalshi is CFTC-regulated in the U.S.
          </p>
        </div>
      </section>

      <section className="panel">
        <h2>Danger zone</h2>
        <button className="btn red block" onClick={reset}>
          Reset paper account
        </button>
      </section>
    </>
  );
}
