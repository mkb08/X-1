"use client";

import { useCallback, useEffect, useState } from "react";
import { ago, api } from "@/lib/client";

interface HeadlineRow {
  id: string;
  region: string;
  source: string;
  title: string;
  link: string;
  summary: string;
  published_at: string;
  matched: number;
}

const REGIONS = ["All", "Japan", "Asia", "Europe", "Australia", "Middle East"];

export function News({ refreshKey, feeds }: { refreshKey: number; feeds?: { source: string; region: string; ok: boolean; count: number; error: string | null }[] }) {
  const [region, setRegion] = useState("All");
  const [rows, setRows] = useState<HeadlineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = region === "All" ? "" : `?region=${encodeURIComponent(region)}`;
      const data = await api<{ headlines: HeadlineRow[] }>(`/api/news${q}`);
      setRows(data.headlines);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [region]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const failing = (feeds ?? []).filter((f) => !f.ok);

  return (
    <>
      <div className="chips">
        {REGIONS.map((r) => (
          <button key={r} className={`chip ${region === r ? "active" : ""}`} onClick={() => setRegion(r)}>
            {r}
          </button>
        ))}
      </div>
      {failing.length > 0 && (
        <div className="notice small">
          Last scan couldn&apos;t read: {failing.map((f) => `${f.source} (${f.error ?? "error"})`).join(", ")}. Other feeds still ran.
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      {rows === null && !error && <div className="empty">Loading…</div>}
      {rows?.length === 0 && <div className="empty">No headlines stored yet. Run a scan from the Desk tab.</div>}
      {rows?.map((h) => (
        <a key={h.id} className="card" href={h.link} target="_blank" rel="noreferrer" style={{ display: "block" }}>
          <div className="row between">
            <span className="small dim">
              {h.region} · {h.source}
            </span>
            <span className="small dim mono">{ago(h.published_at)}</span>
          </div>
          <div className="headline" style={{ marginBottom: 0 }}>
            {h.title}
          </div>
          {h.matched > 0 && (
            <div style={{ marginTop: 6 }}>
              <span className="badge WATCH">
                {h.matched} market match{h.matched > 1 ? "es" : ""}
              </span>
            </div>
          )}
        </a>
      ))}
    </>
  );
}
