"use client";

import { useCallback, useEffect, useState } from "react";
import { ago, api, cents } from "@/lib/client";
import type { SignalRow } from "@/lib/types";
import { Checks } from "./shared";

const FILTERS = ["PASS", "ALL", "DROP", "WATCH"] as const;
type Filter = (typeof FILTERS)[number];

export function Signals({ refreshKey, onTrade }: { refreshKey: number; onTrade: (signalId: number) => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [signals, setSignals] = useState<SignalRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const q = filter === "ALL" ? "" : `?verdict=${filter}`;
      const data = await api<{ signals: SignalRow[] }>(`/api/signals${q}`);
      setSignals(data.signals);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  return (
    <>
      <div className="chips" role="tablist">
        {FILTERS.map((f) => (
          <button key={f} className={`chip ${filter === f ? "active" : ""}`} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      {error && <div className="notice error">{error}</div>}
      {signals === null && !error && <div className="empty">Loading…</div>}
      {signals?.length === 0 && (
        <div className="empty">
          {filter === "PASS"
            ? "No signal has passed every check yet. That's normal: real gaps are rare, and the checks are strict on purpose."
            : "No signals yet. Run a scan from the Desk tab."}
        </div>
      )}
      {signals?.map((s) => (
        <article key={s.id} className={`card ${s.verdict === "PASS" ? "pass" : ""}`}>
          <div className="row between">
            <div className="row">
              <span className={`badge ${s.verdict}`}>{s.verdict}</span>
              <span className={`badge ${s.venue}`}>{s.venue.toUpperCase()}</span>
            </div>
            <span className="small dim mono">{ago(s.created_at)}</span>
          </div>

          <a className="headline" href={s.headline_url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
            {s.headline}
          </a>
          <div className="small dim">
            {s.region} · {s.source} · published {ago(s.published_at)}
          </div>

          <a className="market" href={s.market_url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
            <span className="dim small">MARKET ↗</span>
            <br />
            {s.market_question}
          </a>

          {s.side !== null && (
            <div className="nums">
              <span>
                buy <b>{s.side_label}</b>
              </span>
              <span>
                ask <b>{cents(s.market_price)}</b>
              </span>
              <span>
                fair <b>{cents(s.fair_prob)}</b>
              </span>
              <span className={Number(s.edge) > 0 ? "pos" : "neg"}>
                edge <b className={Number(s.edge) > 0 ? "pos" : "neg"}>{s.edge === null ? "—" : `${(Number(s.edge) * 100).toFixed(1)}¢`}</b>
              </span>
            </div>
          )}

          <Checks checks={s.checks} />
          {s.reasoning && <p className="reason">{s.reasoning}</p>}

          {s.side !== null && (
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className={`btn sm ${s.verdict === "PASS" ? "green" : ""}`}
                disabled={busy === s.id}
                onClick={async () => {
                  setBusy(s.id);
                  await onTrade(s.id);
                  setBusy(null);
                }}
              >
                {busy === s.id ? "Placing…" : `Paper-buy ${s.side_label}`}
              </button>
              <span className="small dim">at the live ask</span>
            </div>
          )}
        </article>
      ))}
    </>
  );
}
