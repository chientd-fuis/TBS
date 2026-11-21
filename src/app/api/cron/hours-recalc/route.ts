import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { runMonthEndRecalc } from "@/lib/hours-recalc-server";
import { logError } from "@/lib/error-log";

export const preferredRegion = "sin1";
export const maxDuration = 60;

/** Tính lại giờ công lúc 23:59 giờ VN (vercel.json "59 16 * * *") – chỉ chạy thật vào ngày cuối tháng, chế độ "23:59 ngày cuối tháng". */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  try {
    return NextResponse.json(await runMonthEndRecalc());
  } catch (e) {
    logError({ level: "error", source: "system", area: "Tính lại giờ công cuối tháng (cron)", fn: "runMonthEndRecalc", message: (e as Error).message, detail: (e as Error).stack });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
