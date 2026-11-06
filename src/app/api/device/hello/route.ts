import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/guards";
import { registerDevice, resolveDeviceId } from "@/lib/device";
import { jsonError } from "@/lib/api";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ state: "UNKNOWN" });
    const body = (await req.json().catch(() => ({}))) as { localId?: string; fingerprint?: string };
    let deviceId = await resolveDeviceId(body.localId);
    if (!deviceId) deviceId = crypto.randomUUID();
    const r = await registerDevice(user._id, user.status, deviceId, String(body.fingerprint || "").slice(0, 128));
    return NextResponse.json(r);
  } catch (e) {
    return jsonError(e);
  }
}
