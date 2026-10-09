import { errorResponse, requirePasscode } from "@/lib/auth";
import { closeTrade } from "@/lib/paper";

export const dynamic = "force-dynamic";

/** Close an open paper position at the current bid. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  try {
    const { id } = await params;
    const trade = await closeTrade(Number(id));
    return Response.json({ trade });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
