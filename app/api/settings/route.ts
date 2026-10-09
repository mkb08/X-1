import { errorResponse, requirePasscode } from "@/lib/auth";
import { saveSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = requirePasscode(req);
  if (denied) return denied;
  try {
    const patch = (await req.json()) as Partial<Settings>;
    return Response.json({ settings: await saveSettings(patch) });
  } catch (err) {
    return errorResponse(err, 400);
  }
}
