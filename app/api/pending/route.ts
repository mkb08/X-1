import { errorResponse, requirePasscode } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { pendingForReview } from "@/lib/routine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Unscored matches plus the instructions to judge them (used by the Claude Code routine). */
export async function GET(req: Request) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  if (!hasDatabase()) return Response.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const n = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(n) && n > 0 ? Math.min(40, Math.floor(n)) : 20;
  try {
    return Response.json(await pendingForReview(limit));
  } catch (err) {
    return errorResponse(err);
  }
}
