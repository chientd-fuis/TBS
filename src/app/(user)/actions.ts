"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { AdjustmentRequest, PayrollFeedback, PayrollItem } from "@/lib/models";

export type FormState = { ok?: boolean; error?: string } | null;

/** Nhân viên gửi yêu cầu điều chỉnh chấm công (quên chấm, GPS lỗi…) – spec 7.1 */
export async function submitAdjustment(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireActiveUser();
  const workDate = String(fd.get("workDate") || "");
  const checkInTime = String(fd.get("checkInTime") || "");
  const checkOutTime = String(fd.get("checkOutTime") || "");
  const reason = String(fd.get("reason") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: "Chọn ngày" };
  if (!checkInTime && !checkOutTime) return { error: "Nhập giờ vào hoặc giờ ra" };
  if (reason.length < 5) return { error: "Nhập lý do (ít nhất 5 ký tự)" };
  await AdjustmentRequest.create({
    userId: user._id,
    storeId: user.storeId,
    attendanceId: fd.get("attendanceId") || undefined,
    workDate,
    checkInTime,
    checkOutTime,
    reason,
  });
  revalidatePath("/history");
  return { ok: true };
}

/** Phản hồi / khiếu nại bảng lương – spec 4.6 */
export async function submitPayrollFeedback(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireActiveUser();
  const itemId = String(fd.get("itemId") || "");
  const content = String(fd.get("content") || "").trim();
  if (content.length < 5) return { error: "Nhập nội dung (ít nhất 5 ký tự)" };
  const item = await PayrollItem.findOne({ _id: itemId, userId: user._id }).lean();
  if (!item) return { error: "Không tìm thấy bảng lương" };
  await PayrollFeedback.create({ payrollItemId: item._id, userId: user._id, storeId: item.storeId, month: item.month, content });
  revalidatePath("/payroll");
  return { ok: true };
}
