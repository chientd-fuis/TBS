import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminActor, getAdmin } from "@/lib/admin-session";
import { saveDriveTokenFromCode } from "@/lib/drive";
import { audit } from "@/lib/audit";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const admin = await getAdmin();
  if (admin?.kind !== "OWNER") return NextResponse.redirect(new URL("/admin/login", req.url));
  const jar = await cookies();
  const state = jar.get("tbs_gstate")?.value;
  jar.delete("tbs_gstate");
  const back = new URL("/admin/settings", req.url);
  if (!state || state !== url.searchParams.get("state")) {
    back.searchParams.set("drive", "state-error");
    return NextResponse.redirect(back);
  }
  const code = url.searchParams.get("code");
  if (!code) {
    back.searchParams.set("drive", "denied");
    return NextResponse.redirect(back);
  }
  try {
    const email = await saveDriveTokenFromCode(code);
    await audit(adminActor(admin), "google.connect", { type: "Settings" }, null, { email });
    back.searchParams.set("drive", "ok");
  } catch (e) {
    back.searchParams.set("drive", "error");
    back.searchParams.set("msg", (e as Error).message.slice(0, 200));
  }
  return NextResponse.redirect(back);
}
