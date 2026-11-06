import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { markMissingCheckouts } from "@/lib/attendance";
import { retryPendingPhotos } from "@/lib/drive";
import { autoPublishPayrolls, ensureDraftPayrolls } from "@/lib/payroll";
import { connectDB } from "@/lib/db";
import { retryFailedClosings } from "@/lib/closing";

/** Hằng giờ: đánh dấu quên check-out, upload lại ảnh chờ, tạo bảng lương nháp, công bố nếu đã qua ngày 5. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  await connectDB();
  const missing = await markMissingCheckouts();
  const uploaded = await retryPendingPhotos();
  await ensureDraftPayrolls();
  const published = await autoPublishPayrolls(); // dự phòng nếu cron ngày 5 bị lỡ
  const closingsResent = await retryFailedClosings(); // gửi lại ảnh chốt ca lên Telegram
  return NextResponse.json({ missing, uploaded, published, closingsResent });
}
