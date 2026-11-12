import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { runAutoCheckout } from "@/lib/auto-checkout";

export const preferredRegion = "sin1";
export const maxDuration = 60;

/** Tự động check-out nhân viên ca tối còn trong ca (cơ sở bật ở Cài đặt) – cron khoảng 23h giờ VN (vercel.json). */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(await runAutoCheckout());
}
