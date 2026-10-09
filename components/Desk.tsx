"use client";

import { ago, signClass, until, usd } from "@/lib/client";
import { EquityChart, SessionStrip, useNow, type AppState } from "./shared";

export function Desk({
  state,
  scanning,
  onScan,
}: {
  state: AppState;
  scanning: boolean;
  onScan: () => void;
}) {
  useNow(15_000);
  const pf = state.portfolio;
  const last = state.scans?.[0];
  const nextAllowed = last ? new Date(new Date(last.started_at).getTime() + state.config.minScanIntervalMin * 60_000).toISOString() : null;
  const waiting = nextAllowed ? new Date(nextAllowed).getTime() > Date.now() : false;
  const pnl = pf ? pf.equity - pf.bankroll : 0;
  const winRate = pf && pf.closedTrades ? Math.round((pf.wins / pf.closedTrades) * 100) : null;

  return (
    <>
      <SessionStrip />

      {!state.config.database && (
        <div className="notice error">
          <strong>Database not connected.</strong> Add <code>DATABASE_URL</code> in Vercel → Project → Settings → Environment Variables, then redeploy.
        </div>
      )}
      {state.config.database && !state.config.ai && (
        <div className="notice">
          <strong>AI analysis is off.</strong> The scanner still pulls news and matches markets, but nothing gets scored or traded until you add <code>ANTHROPIC_API_KEY</code> in Vercel → Settings → Environment Variables and redeploy.
        </div>
      )}
      {state.error && <div className="notice error">{state.error}</div>}

      <section className="panel">
        <h2>
          Paper equity <span className="pill">no real money</span>
        </h2>
        <div className="equity-value">{usd(pf?.equity ?? state.settings?.startingBankroll ?? 0)}</div>
        <div className={`mono small ${signClass(pnl)}`}>
          {usd(pnl, true)} ({pf && pf.bankroll ? ((pnl / pf.bankroll) * 100).toFixed(2) : "0.00"}%) since start
        </div>
        <EquityChart points={state.equity ?? []} baseline={pf?.bankroll ?? 0} />
        <div className="stats">
          <div className="stat">
            <div className="k">Cash</div>
            <div className="v">{usd(pf?.cash, false, true)}</div>
          </div>
          <div className="stat">
            <div className="k">Realized</div>
            <div className={`v ${signClass(pf?.realized)}`}>{usd(pf?.realized, true, true)}</div>
          </div>
          <div className="stat">
            <div className="k">Open P&amp;L</div>
            <div className={`v ${signClass(pf?.unrealized)}`}>{usd(pf?.unrealized, true, true)}</div>
          </div>
          <div className="stat">
            <div className="k">Positions</div>
            <div className="v">{pf?.openPositions ?? 0}</div>
          </div>
          <div className="stat">
            <div className="k">Win rate</div>
            <div className="v">{winRate === null ? "—" : `${winRate}%`}</div>
          </div>
          <div className="stat">
            <div className="k">Pass / 24h</div>
            <div className="v">
              {Number(state.counts?.passes24h ?? 0)}/{Number(state.counts?.signals24h ?? 0)}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>
          Scanner
          <span className="pill">
            <span className={`dot ${last && !last.error ? "on" : last?.error ? "off" : ""}`} />
            {last ? `last ${ago(last.started_at)}` : "never run"}
          </span>
        </h2>
        <button className="btn primary block" disabled={scanning || waiting || !state.config.database} onClick={onScan}>
          {scanning ? "Scanning overseas news…" : waiting ? `Next scan allowed in ${until(nextAllowed)}` : "Scan now"}
        </button>
        <p className="small dim" style={{ marginBottom: 0 }}>
          Runs automatically every 30 minutes. Each scan reads overseas headlines, matches them to open Kalshi and Polymarket markets, has
          Claude judge each match, and paper-trades the ones that pass every check.
        </p>
        {last && (
          <div className="small" style={{ marginTop: 10 }}>
            {last.error && <div className="notice error">Last scan failed: {last.error}</div>}
            {last.notes && (
              <div className="dim mono" style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>
                {last.notes}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Recent scans</h2>
        {(state.scans ?? []).length === 0 && <div className="empty small">No scans yet. Tap “Scan now”.</div>}
        {(state.scans ?? []).map((s) => (
          <div className="list-row" key={s.id}>
            <span className="muted">
              {new Date(s.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {s.trigger}
            </span>
            <span>
              {s.error ? (
                <span className="neg">error</span>
              ) : !s.finished_at ? (
                <span className="dim">running…</span>
              ) : (
                <>
                  {s.headlines} news · {s.candidates} links · <span className={s.passes ? "pos" : ""}>{s.passes} pass</span>
                  {s.trades_opened ? ` · ${s.trades_opened} trade` : ""}
                </>
              )}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
