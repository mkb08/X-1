import { errorResponse } from "@/lib/auth";
import { aiConfigured, aiModel, analysisMode } from "@/lib/analyze";
import { hasDatabase, ready } from "@/lib/db";
import { portfolio } from "@/lib/paper";
import { minScanIntervalMs } from "@/lib/scan";
import { loadSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = {
    database: hasDatabase(),
    ai: aiConfigured(),
    analysis: analysisMode(),
    model: aiModel(),
    passcode: Boolean(process.env.APP_PASSCODE),
    minScanIntervalMin: minScanIntervalMs() / 60_000,
  };
  if (!config.database) return Response.json({ config });
  try {
    const sql = await ready();
    const settings = await loadSettings();
    const [pf, scans, equity, openTrades, closedTrades, counts] = await Promise.all([
      portfolio(settings),
      sql`SELECT * FROM scans ORDER BY id DESC LIMIT 12`,
      sql`SELECT ts, equity FROM (SELECT ts, equity FROM equity ORDER BY ts DESC LIMIT 600) e ORDER BY ts ASC`,
      sql`SELECT * FROM trades WHERE status = 'open' ORDER BY opened_at DESC`,
      sql`SELECT * FROM trades WHERE status <> 'open' ORDER BY closed_at DESC LIMIT 60`,
      sql`SELECT
            COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') AS signals24h,
            COUNT(*) FILTER (WHERE verdict = 'PASS' AND created_at > now() - interval '24 hours') AS passes24h,
            (SELECT COUNT(*) FROM headlines WHERE published_at > now() - interval '24 hours') AS headlines24h
          FROM signals`,
    ]);
    return Response.json({ config, settings, portfolio: pf, scans, equity, openTrades, closedTrades, counts: counts[0] });
  } catch (err) {
    return errorResponse(err);
  }
}
