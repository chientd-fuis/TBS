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

/** Nhân viên tự sửa họ tên, SĐT, ngân hàng, số tài khoản. */
export async function updateMyProfile(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireActiveUser();
  const name = String(fd.get("name") || "").trim();
  const phone = String(fd.get("phone") || "").trim();
  const bankName = String(fd.get("bankName") || "").trim();
  const bankAccount = String(fd.get("bankAccount") || "").replace(/\s+/g, "");
  if (name.length < 2 || name.length > 80) return { error: "Họ tên 2–80 ký tự" };
  if (!/^[0-9+().\-\s]{8,20}$/.test(phone)) return { error: "Số điện thoại không hợp lệ" };
  if (bankName.length > 60) return { error: "Tên ngân hàng quá dài" };
  if (bankAccount && !/^[0-9A-Za-z]{4,30}$/.test(bankAccount)) return { error: "Số tài khoản chỉ gồm chữ số (4–30 ký tự)" };
  const { User } = await import("@/lib/models");
  const { encrypt, decrypt } = await import("@/lib/crypto");
  const { audit } = await import("@/lib/audit");
  const before = { name: user.name, phone: user.phone, bankName: user.bankName };
  const accChanged = !!bankAccount && bankAccount !== decrypt(user.bankAccountEnc);
  await User.updateOne(
    { _id: user._id },
    { $set: { name, phone, bankName, ...(accChanged ? { bankAccountEnc: encrypt(bankAccount) } : {}) } },
  );
  await audit({ kind: "USER", name: user.email }, "user.selfUpdate", { type: "User", id: String(user._id) }, before, { name, phone, bankName, bankAccountChanged: accChanged });
  revalidatePath("/", "layout");
  return { ok: true };
}
