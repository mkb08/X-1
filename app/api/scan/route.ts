import { hasPasscode, errorResponse } from "@/lib/auth";
import { hasDatabase } from "@/lib/db";
import { runScan } from "@/lib/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request, trigger: string) {
  if (!hasDatabase()) return Response.json({ error: "DATABASE_URL is not configured." }, { status: 503 });
  const url = new URL(req.url);
  const isCron = Boolean(process.env.CRON_SECRET) && req.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET}`;
  const force = url.searchParams.get("force") === "1" && (hasPasscode(req) || isCron);
  try {
    const result = await runScan(isCron ? "vercel-cron" : url.searchParams.get("trigger") ?? trigger, force);
    return Response.json(result, { status: result.error ? 500 : 200 });
  } catch (err) {
    return errorResponse(err);
  }
}

// GET is used by schedulers (Vercel Cron, GitHub Actions); POST by the app's "Scan now" button.
export async function GET(req: Request) {
  return handle(req, "schedule");
}

export async function POST(req: Request) {
  return handle(req, "manual");
}
