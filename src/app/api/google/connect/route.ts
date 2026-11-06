import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAdmin } from "@/lib/admin-session";
import { driveConsentUrl } from "@/lib/drive";

/** Chủ kết nối Google Drive (OAuth, scope drive.file) – spec 2.1 */
export async function GET(req: Request) {
  const admin = await getAdmin();
  if (admin?.kind !== "OWNER") return NextResponse.redirect(new URL("/admin/login", req.url));
  const state = crypto.randomUUID();
  (await cookies()).set("tbs_gstate", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(driveConsentUrl(state));
}
