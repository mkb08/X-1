"use client";

const PASS_KEY = "tzarb.passcode";

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPasscode(v: string) {
  try {
    if (v) localStorage.setItem(PASS_KEY, v);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    /* storage unavailable (private mode) */
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(getPasscode() ? { "x-passcode": getPasscode() } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const usd = (n: number | null | undefined, signed = false, compact = false) => {
  const v = Number(n ?? 0);
  const digits = compact && Math.abs(v) >= 1000 ? 0 : 2;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  if (signed) return `${v > 0 ? "+" : v < 0 ? "−" : ""}$${s}`;
  return `${v < 0 ? "−" : ""}$${s}`;
};

export const cents = (p: number | null | undefined) => (p == null ? "—" : `${(Number(p) * 100).toFixed(0)}¢`);

export function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(h < 10 ? 1 : 0)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function until(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const m = Math.ceil(ms / 60000);
  return m < 60 ? `${m}m` : `${(m / 60).toFixed(1)}h`;
}

export const signClass = (n: number | null | undefined) => (Number(n ?? 0) > 0 ? "pos" : Number(n ?? 0) < 0 ? "neg" : "");
