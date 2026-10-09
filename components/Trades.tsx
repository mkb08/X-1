"use client";

import { ago, cents, signClass, usd } from "@/lib/client";
import type { TradeRow } from "@/lib/types";

function openPnl(t: TradeRow): number {
  return Number(t.shares) * Number(t.mark_price ?? t.entry_price) - Number(t.stake) - Number(t.fees);
}

export function Trades({
  open,
  closed,
  busyId,
  onClose,
}: {
  open: TradeRow[];
  closed: TradeRow[];
  busyId: number | null;
  onClose: (id: number) => void;
}) {
  return (
    <>
      <section className="panel">
        <h2>
          Open positions <span className="pill">{open.length}</span>
        </h2>
        {open.length === 0 && <div className="empty small">No open paper positions.</div>}
        {open.map((t) => {
          const pnl = openPnl(t);
          return (
            <div className="card" key={t.id} style={{ background: "var(--panel-2)" }}>
              <div className="row between">
                <div className="row">
                  <span className={`badge ${t.venue}`}>{t.venue.toUpperCase()}</span>
                  {t.auto && <span className="badge">AUTO</span>}
                </div>
                <span className={`mono ${signClass(pnl)}`}>{usd(pnl, true)}</span>
              </div>
              <a className="headline" href={t.market_url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                {t.market_question}
              </a>
              <div className="nums">
                <span>
                  <b>{t.side_label}</b>
                </span>
                <span>
                  entry <b>{cents(t.entry_price)}</b>
                </span>
                <span>
                  now <b>{cents(t.mark_price)}</b>
                </span>
                <span>
                  stake <b>{usd(t.stake)}</b>
                </span>
              </div>
              {t.note && <p className="reason">Signal: {t.note}</p>}
              <div className="row between" style={{ marginTop: 8 }}>
                <span className="small dim">
                  opened {ago(t.opened_at)} · priced {ago(t.marked_at)}
                </span>
                <button className="btn sm red" disabled={busyId === t.id} onClick={() => onClose(t.id)}>
                  {busyId === t.id ? "Closing…" : "Close at bid"}
                </button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="panel">
        <h2>
          Closed &amp; settled <span className="pill">{closed.length}</span>
        </h2>
        {closed.length === 0 && <div className="empty small">Nothing closed yet. Positions settle automatically when their market resolves.</div>}
        {closed.map((t) => (
          <div className="list-row" key={t.id} style={{ alignItems: "flex-start" }}>
            <span style={{ fontFamily: "var(--sans)", fontSize: 13 }}>
              <span className={`badge ${Number(t.pnl) > 0 ? "win" : "loss"}`}>{t.status === "settled" ? "SETTLED" : "CLOSED"}</span>{" "}
              {t.market_question}
              <span className="dim">
                {" "}
                · {t.side_label} {cents(t.entry_price)}→{cents(t.exit_price)} · {ago(t.closed_at)}
              </span>
            </span>
            <span className={signClass(t.pnl)} style={{ whiteSpace: "nowrap" }}>
              {usd(t.pnl, true)}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
