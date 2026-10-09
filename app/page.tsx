"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Desk } from "@/components/Desk";
import { News } from "@/components/News";
import { SettingsTab } from "@/components/SettingsTab";
import { Signals } from "@/components/Signals";
import { Trades } from "@/components/Trades";
import { Icons, type AppState } from "@/components/shared";
import { api } from "@/lib/client";

const TABS = [
  { id: "desk", label: "Desk", Icon: Icons.desk },
  { id: "signals", label: "Signals", Icon: Icons.signals },
  { id: "trades", label: "Trades", Icon: Icons.trades },
  { id: "news", label: "News", Icon: Icons.news },
  { id: "settings", label: "Settings", Icon: Icons.settings },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function Home() {
  const [tab, setTab] = useState<Tab>("desk");
  const [state, setState] = useState<AppState | null>(null);
  const [scanning, setScanning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [busyTrade, setBusyTrade] = useState<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>("/api/state"));
    } catch (e) {
      setState((s) => ({ ...(s ?? { config: { database: false, ai: false, analysis: "off" as const, model: "", passcode: false, minScanIntervalMin: 10 } }), error: (e as Error).message }));
    }
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tzarb.tab") as Tab | null;
      if (saved && TABS.some((t) => t.id === saved)) setTab(saved);
    } catch {
      /* ignore */
    }
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const go = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("tzarb.tab", t);
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0 });
  };

  async function scan() {
    setScanning(true);
    try {
      const r = await api<{ skipped?: string; passes?: number; candidates?: number; evaluated?: number; tradesOpened?: number; error?: string }>(
        "/api/scan?trigger=manual",
        { method: "POST" },
      );
      if (r.skipped) toast(r.skipped);
      else
        toast(
          `Scan done: ${r.candidates ?? 0} matches, ${r.evaluated ?? 0} judged by AI, ${r.passes ?? 0} pass${r.tradesOpened ? `, ${r.tradesOpened} paper trade(s) opened` : ""}.`,
        );
    } catch (e) {
      toast((e as Error).message);
    }
    setScanning(false);
    refresh();
  }

  async function trade(signalId: number) {
    try {
      await api("/api/trades", { method: "POST", body: { signalId } });
      toast("Paper position opened.");
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function closeTrade(id: number) {
    setBusyTrade(id);
    try {
      const r = await api<{ trade: { pnl: number } }>(`/api/trades/${id}`, { method: "POST" });
      toast(`Closed. P&L ${r.trade.pnl >= 0 ? "+" : "−"}$${Math.abs(r.trade.pnl).toFixed(2)}`);
      refresh();
    } catch (e) {
      toast((e as Error).message);
    }
    setBusyTrade(null);
  }

  const passCount = Number(state?.counts?.passes24h ?? 0);

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          TZ<span>/</span>ARB <span className="dim" style={{ color: "var(--dim)", fontWeight: 400 }}>night desk</span>
        </div>
        <span className="pill">
          <span className={`dot ${state && state.config.analysis !== "off" && state.config.database ? "on" : state ? "warn" : ""}`} />
          {state ? { api: "AI on", routine: "AI hourly", off: "AI off" }[state.config.analysis] : "…"} · paper
        </span>
      </header>

      {!state && <div className="empty">Loading desk…</div>}
      {state && tab === "desk" && <Desk state={state} scanning={scanning} onScan={scan} />}
      {state && tab === "signals" && <Signals refreshKey={refreshKey} onTrade={trade} />}
      {state && tab === "trades" && (
        <Trades open={state.openTrades ?? []} closed={state.closedTrades ?? []} busyId={busyTrade} onClose={closeTrade} />
      )}
      {state && tab === "news" && <News refreshKey={refreshKey} feeds={state.scans?.find((s) => s.feeds)?.feeds} />}
      {state && tab === "settings" && <SettingsTab state={state} onSaved={refresh} toast={toast} />}

      {toastMsg && (
        <div className="toast" role="status" onClick={() => setToastMsg(null)}>
          {toastMsg}
        </div>
      )}

      <nav className="tabbar" aria-label="Sections">
        <div className="tabbar-inner">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} className={`tab ${tab === id ? "active" : ""}`} onClick={() => go(id)} aria-current={tab === id}>
              <Icon />
              {label}
              {id === "signals" && passCount > 0 && <span className="count">{passCount}</span>}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
