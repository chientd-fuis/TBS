import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron";
import { markMissingCheckouts } from "@/lib/attendance";
import { retryPendingPhotos } from "@/lib/drive";
import { autoPublishPayrolls, ensureDraftPayrolls } from "@/lib/payroll";
import { connectDB } from "@/lib/db";
import { retryFailedClosings } from "@/lib/closing";
import { migrateDayCalc, syncPendingDays } from "@/lib/day-revenue";
import { runScheduledReports } from "@/lib/finance-report";
import { ensureTtlIndexes, runAutoCleanup } from "@/lib/cleanup";
import { runDailyAnomaly } from "@/lib/anomaly";
import { runAutoPenalties } from "@/lib/auto-penalty";
import { runProbation } from "@/lib/probation";

// Gemini API không hỗ trợ Hong Kong (region mặc định hkg1) → chạy hàm này ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;

/** Hằng giờ: đánh dấu quên check-out, upload lại ảnh chờ, tạo bảng lương nháp, công bố nếu đã qua ngày 5. */
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  await connectDB();
  const missing = await markMissingCheckouts();
  const penalties = await runAutoPenalties().catch((e: Error) => ({ error: e.message })); // phạt tự động: muộn / bỏ ca / quên chấm công
  const probation = await runProbation().catch((e: Error) => ({ error: e.message })); // hết tháng thử việc → chính thức 22k/h hoặc "cần xem xét"
  const uploaded = await retryPendingPhotos();
  await ensureDraftPayrolls();
  const published = await autoPublishPayrolls(); // dự phòng nếu cron ngày 5 bị lỡ
  const closingsResent = await retryFailedClosings(); // gửi lại ảnh chốt ca lên Telegram
  const recalculated = await migrateDayCalc(); // tính lại doanh thu ngày theo cách luỹ kế (dữ liệu cũ)
  const sheetDays = await syncPendingDays(); // ghi Google Sheet các ngày chưa ghi được
  const reports = await runScheduledReports().catch((e: Error) => ({ error: e.message })); // báo cáo ngày/tuần/tháng → nhóm Quản lý doanh thu
  const ttl = await ensureTtlIndexes().catch((e: Error) => ({ error: e.message })); // log cũ tự xoá theo thời gian
  const anomaly = await runDailyAnomaly().catch((e: Error) => ({ error: e.message })); // bất thường chốt ca & két → Telegram + Tổng quan
  const cleanup = await runAutoCleanup().catch((e: Error) => ({ error: e.message })); // tự dọn rác mỗi tháng 1 lần (nếu bật)
  return NextResponse.json({ missing, penalties, probation, uploaded, published, closingsResent, recalculated, sheetDays, reports, ttl, anomaly, cleanup });
}
