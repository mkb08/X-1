export interface Exchange {
  city: string;
  name: string;
  tz: string;
  open: [number, number]; // local hour, minute
  close: [number, number];
  /** Optional lunch break (Tokyo). */
  lunch?: [[number, number], [number, number]];
  weekend: number[]; // 0 = Sunday
}

export const EXCHANGES: Exchange[] = [
  { city: "Sydney", name: "ASX", tz: "Australia/Sydney", open: [10, 0], close: [16, 0], weekend: [0, 6] },
  { city: "Tokyo", name: "TSE", tz: "Asia/Tokyo", open: [9, 0], close: [15, 30], lunch: [[11, 30], [12, 30]], weekend: [0, 6] },
  { city: "Hong Kong", name: "HKEX", tz: "Asia/Hong_Kong", open: [9, 30], close: [16, 0], lunch: [[12, 0], [13, 0]], weekend: [0, 6] },
  { city: "Dubai", name: "DFM", tz: "Asia/Dubai", open: [10, 0], close: [15, 0], weekend: [0, 6] },
  { city: "London", name: "LSE", tz: "Europe/London", open: [8, 0], close: [16, 30], weekend: [0, 6] },
  { city: "Frankfurt", name: "Xetra", tz: "Europe/Berlin", open: [9, 0], close: [17, 30], weekend: [0, 6] },
  { city: "New York", name: "NYSE", tz: "America/New_York", open: [9, 30], close: [16, 0], weekend: [0, 6] },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localParts(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday: WEEKDAYS.indexOf(get("weekday")), hour, minute, label: `${String(hour).padStart(2, "0")}:${get("minute")}` };
}

export type SessionState = "open" | "lunch" | "closed" | "weekend";

export function sessionState(ex: Exchange, at: Date): { state: SessionState; time: string } {
  const p = localParts(ex.tz, at);
  const mins = p.hour * 60 + p.minute;
  const toMin = ([h, m]: [number, number]) => h * 60 + m;
  if (ex.weekend.includes(p.weekday)) return { state: "weekend", time: p.label };
  if (mins < toMin(ex.open) || mins >= toMin(ex.close)) return { state: "closed", time: p.label };
  if (ex.lunch && mins >= toMin(ex.lunch[0]) && mins < toMin(ex.lunch[1])) return { state: "lunch", time: p.label };
  return { state: "open", time: p.label };
}

/** The "gap": U.S. traders are offline while other regions are producing news. */
export function usOvernight(at: Date): boolean {
  const p = localParts("America/New_York", at);
  return p.hour >= 20 || p.hour < 8 || p.weekday === 0 || p.weekday === 6;
}
