import { errorResponse } from "@/lib/auth";
import { hasDatabase, ready } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasDatabase()) return Response.json({ signals: [] });
  const verdict = new URL(req.url).searchParams.get("verdict");
  try {
    const sql = await ready();
    const signals =
      verdict === "PASS" || verdict === "DROP" || verdict === "WATCH"
        ? await sql`SELECT * FROM signals WHERE verdict = ${verdict} ORDER BY created_at DESC, edge DESC NULLS LAST LIMIT 150`
        : await sql`SELECT * FROM signals ORDER BY created_at DESC, (verdict = 'PASS') DESC, edge DESC NULLS LAST LIMIT 150`;
    return Response.json({ signals });
  } catch (err) {
    return errorResponse(err);
  }
}
