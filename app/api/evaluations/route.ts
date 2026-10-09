import { errorResponse, requirePasscode } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { applyReview } from "@/lib/routine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Accept judgments for pending matches, run the checks, and paper-trade PASS signals. */
export async function POST(req: Request) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  if (!hasDatabase()) return Response.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  try {
    const body = (await req.json().catch(() => null)) as { evaluations?: unknown } | null;
    if (!body || !Array.isArray(body.evaluations)) {
      return Response.json({ error: 'Send {"evaluations": [...]} as JSON.' }, { status: 400 });
    }
    return Response.json(await applyReview(body.evaluations));
  } catch (err) {
    return errorResponse(err);
  }
}
