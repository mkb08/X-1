"use client";

import { useEffect, useState } from "react";
import type { Portfolio } from "@/lib/paper";
import { EXCHANGES, sessionState, usOvernight } from "@/lib/sessions";
import type { ScanRow, Settings, TradeRow } from "@/lib/types";

export interface AppState {
  config: { database: boolean; ai: boolean; model: string; passcode: boolean; minScanIntervalMin: number };
  settings?: Settings;
  portfolio?: Portfolio;
  scans?: (ScanRow & { feeds?: { source: string; region: string; ok: boolean; count: number; error: string | null }[] })[];
  equity?: { ts: string; equity: number }[];
  openTrades?: TradeRow[];
  closedTrades?: TradeRow[];
  counts?: { signals24h: string | number; passes24h: string | number; headlines24h: string | number };
  error?: string;
}

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function SessionStrip() {
  const now = useNow();
  const gap = usOvernight(now);
  return (
    <>
      <div className="sessions" aria-label="World market sessions">
        {EXCHANGES.map((ex) => {
          const s = sessionState(ex, now);
          return (
            <div key={ex.city} className={`session ${s.state === "open" ? "open" : ""}`}>
              <div className="city">
                <span className={`dot ${s.state === "open" ? "on" : s.state === "lunch" ? "warn" : ""}`} />
                {ex.city}
              </div>
              <div className="clock">{s.time}</div>
              <div className="state">
                {ex.name} · {s.state.toUpperCase()}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`gap-banner ${gap ? "active" : ""}`}>
        {gap ? (
          <>
            <strong>Gap window open.</strong> <span className="muted">U.S. traders are mostly offline while overseas news keeps breaking. This is when the scanner looks for markets that haven&apos;t caught up yet.</span>
          </>
        ) : (
          <>
            <strong>U.S. session active.</strong> <span className="muted">Markets reprice fastest now; overseas edges usually close quickly during these hours.</span>
          </>
        )}
      </div>
    </>
  );
}

export function EquityChart({ points, baseline }: { points: { ts: string; equity: number }[]; baseline: number }) {
  if (points.length < 2) {
    return <div className="empty small">The equity curve appears after the first two scans.</div>;
  }
  const W = 600;
  const H = 120;
  const ys = points.map((p) => Number(p.equity));
  const min = Math.min(baseline, ...ys);
  const max = Math.max(baseline, ...ys);
  const pad = (max - min) * 0.1 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = ys.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = ys[ys.length - 1] >= baseline;
  const color = up ? "var(--green)" : "var(--red)";
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Paper equity over time">
      <defs>
        <linearGradient id="eqfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke="var(--line)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#eqfill)" />
      <path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Checks({ checks }: { checks: { name: string; pass: boolean; detail: string }[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.name}>
          {c.name === "AI analysis" && !c.pass ? (
            <span style={{ color: "var(--amber)" }}>WAIT</span>
          ) : (
            <span className={c.pass ? "ok" : "no"}>{c.pass ? "PASS" : "DROP"}</span>
          )}
          <span>
            {c.name} <span className="detail">· {c.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const icon = (d: string) =>
  function Icon() {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={d} />
      </svg>
    );
  };

export const Icons = {
  desk: icon("M3 17l5-5 4 4 8-9M14 7h6v6"),
  signals: icon("M2 12h3l3-8 4 16 3-8h7"),
  trades: icon("M4 6h16M4 12h16M4 18h10"),
  news: icon("M4 5h13v14H6a2 2 0 0 1-2-2V5zm13 4h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5"),
  settings: icon("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.2-1.3L14.3 3h-4l-.4 2.4a7.6 7.6 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.6 7.6 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z"),
};
