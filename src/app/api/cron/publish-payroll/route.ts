import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { autoPublishPayrolls } from "@/lib/payroll";
import { audit } from "@/lib/audit";

/** 00:00 ngày 5 (giờ VN) – tự chốt & công bố bảng lương tháng trước (spec 3.7). vercel.json: "0 17 4 * *" (UTC) */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const done = await autoPublishPayrolls();
  if (done.length) await audit({ kind: "SYSTEM", name: "cron" }, "payroll.autoPublish", undefined, null, { done });
  return NextResponse.json({ published: done });
}
