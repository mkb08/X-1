import { errorResponse, requirePasscode } from "@/lib/auth";
import { ready } from "@/lib/db";
import { fetchQuote } from "@/lib/markets";
import { openTrade } from "@/lib/paper";
import { loadSettings } from "@/lib/settings";
import type { SignalRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Open a paper position from a signal at the current ask. */
export async function POST(req: Request) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  try {
    const body = (await req.json()) as { signalId?: number; side?: number; stake?: number };
    const sql = await ready();
    const [sig] = (await sql`SELECT * FROM signals WHERE id = ${Number(body.signalId)}`) as SignalRow[];
    if (!sig) return Response.json({ error: "Signal not found." }, { status: 404 });
    const side = body.side === 0 || body.side === 1 ? body.side : sig.side ?? 0;
    const quote = await fetchQuote(sig.venue, sig.market_id);
    if (!quote) return Response.json({ error: "Could not fetch a live price. Try again shortly." }, { status: 502 });
    if (quote.payout) return Response.json({ error: "This market has already resolved." }, { status: 409 });
    const settings = await loadSettings();
    const sideLabel =
      sig.side === side && sig.side_label ? sig.side_label : side === 0 ? "Yes" : "No";
    const trade = await openTrade(
      {
        signalId: sig.id,
        venue: sig.venue,
        marketId: sig.market_id,
        marketQuestion: sig.market_question,
        marketUrl: sig.market_url,
        side,
        sideLabel,
        quote,
        stake: Number(body.stake) > 0 ? Number(body.stake) : settings.stake,
        auto: false,
        note: sig.headline,
      },
      settings,
    );
    return Response.json({ trade });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
