import { errorResponse } from "@/lib/auth";
import { hasDatabase, ready } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!hasDatabase()) return Response.json({ headlines: [] });
  const region = new URL(req.url).searchParams.get("region");
  try {
    const sql = await ready();
    const headlines = region
      ? await sql`SELECT * FROM headlines WHERE region = ${region} AND published_at > now() - interval '24 hours'
                  ORDER BY published_at DESC LIMIT 200`
      : await sql`SELECT * FROM headlines WHERE published_at > now() - interval '24 hours'
                  ORDER BY published_at DESC LIMIT 200`;
    return Response.json({ headlines });
  } catch (err) {
    return errorResponse(err);
  }
}
