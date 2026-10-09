import { errorResponse, requirePasscode } from "@/lib/auth";
import { ready } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Wipe the paper account (trades + equity history). Signals and news are kept. */
export async function POST(req: Request) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "RESET") return Response.json({ error: 'Send {"confirm":"RESET"} to reset.' }, { status: 400 });
    const sql = await ready();
    await sql`DELETE FROM trades`;
    await sql`DELETE FROM equity`;
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
