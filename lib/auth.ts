import { timingSafeEqual } from "node:crypto";

/** Returns an error response when APP_PASSCODE is set and the request doesn't carry it. */
export function requirePasscode(req: Request): Response | null {
  const code = process.env.APP_PASSCODE;
  if (!code) return null;
  return hasPasscode(req) ? null : Response.json({ error: "Passcode required. Enter it in Settings." }, { status: 401 });
}

export function hasPasscode(req: Request): boolean {
  const code = process.env.APP_PASSCODE;
  if (!code) return false;
  const given = Buffer.from(req.headers.get("x-passcode") ?? "");
  const want = Buffer.from(code);
  return given.length === want.length && timingSafeEqual(given, want);
}

export function errorResponse(err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}
