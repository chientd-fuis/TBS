import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { runAutoCheckout } from "@/lib/auto-checkout";

export const preferredRegion = "sin1";
export const maxDuration = 60;

/** Chốt công ca tối (cơ sở bật ở Cài đặt): ghi quên check-out người không làm ca tối còn trong ca – cron khoảng 23h giờ VN (vercel.json). Ca tối quá hạn + tin báo gộp lúc 01:00 do cron đêm xử lý. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  return NextResponse.json(await runAutoCheckout());
}
