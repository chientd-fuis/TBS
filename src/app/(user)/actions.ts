"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { AdjustmentRequest, Attendance, PayrollFeedback, PayrollItem } from "@/lib/models";
import { after } from "next/server";
import { attendancesNear, attText, findOverlap, notifyAdjustment, requestWindow } from "@/lib/adjustment";
import { isMonthLocked, payStoreOf, storeTz } from "@/lib/attendance";
import { localDate, localMonth, localTime, viDate } from "@/lib/time";

export type FormState = { ok?: boolean; error?: string } | null;
/** overlapId: chấm bù trùng lượt đã có → app gợi ý chuyển sang "Sửa giờ" lượt đó */
export type AdjustState = { ok?: boolean; error?: string; overlapId?: string } | null;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Nhân viên gửi yêu cầu chấm công – 2 loại:
 *  - MISSING (Quên chấm công): chấm bù 1 ca app KHÔNG có lượt nào – bắt buộc ngày, giờ vào, giờ ra, lý do; không được trùng lượt đã có.
 *  - EDIT (Sửa giờ ca đã chấm): chọn 1 lượt của mình (quên check-out, vào làm rồi mới check-in…) – admin duyệt sửa ĐÚNG lượt đó.
 * Lỗi → trả thông báo, form phía nhân viên giữ nguyên dữ liệu.
 */
export async function submitAdjustment(_: AdjustState, fd: FormData): Promise<AdjustState> {
  const user = await requireActiveUser();
  const kind = String(fd.get("kind") || "") === "EDIT" ? "EDIT" : "MISSING";
  const checkInTime = String(fd.get("checkInTime") || "").slice(0, 5);
  const checkOutTime = String(fd.get("checkOutTime") || "").slice(0, 5);
  const reason = String(fd.get("reason") || "").trim().slice(0, 300);
  if (!TIME_RE.test(checkInTime)) return { error: "Nhập giờ vào (dạng 24h, VD 08:00)" };
  if (!TIME_RE.test(checkOutTime)) return { error: "Nhập giờ ra (dạng 24h, VD 17:30)" };
  if (reason.length < 5) return { error: "Nhập lý do (ít nhất 5 ký tự)" };
  const now = new Date();

  let workDate: string;
  let storeId = user.storeId;
  let attendanceId: unknown;
  let before: Record<string, unknown> | undefined;
  let tz: string;
  if (kind === "EDIT") {
    const att = await Attendance.findOne({ _id: String(fd.get("attendanceId") || ""), userId: user._id }).lean().catch(() => null);
    if (!att) return { error: "Không tìm thấy lượt chấm công – tải lại trang" };
    if (att.status === "OPEN") return { error: "Lượt này đang trong ca – CHECK-OUT xong rồi mới gửi sửa giờ" };
    if (await AdjustmentRequest.exists({ attendanceId: att._id, status: "PENDING" })) return { error: "Lượt này đã có yêu cầu đang chờ duyệt" };
    if (await isMonthLocked(payStoreOf(att), att.month, user._id)) return { error: `Tháng ${att.month.slice(5)}/${att.month.slice(0, 4)} đã trả lương – liên hệ admin để sửa` };
    tz = await storeTz(att.storeId);
    const hm = (d?: Date | null) => (d ? localTime(d, tz).slice(0, 5) : "");
    if (checkInTime === hm(att.checkInAt) && checkOutTime === hm(att.checkOutAt)) return { error: "Bạn chưa đổi giờ nào so với app đang ghi" };
    workDate = att.workDate;
    storeId = att.storeId;
    attendanceId = att._id;
    before = { checkInAt: att.checkInAt, checkOutAt: att.checkOutAt ?? null, status: att.status, shiftLabel: att.shiftLabel ?? null, roundedHours: att.roundedHours ?? null };
  } else {
    workDate = String(fd.get("workDate") || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return { error: "Chọn ngày làm" };
    tz = await storeTz(user.storeId!);
    if (workDate > localDate(now, tz)) return { error: "Không chấm bù trước cho ngày chưa tới" };
    if (await isMonthLocked(user.storeId!, workDate.slice(0, 7), user._id)) return { error: `Tháng ${workDate.slice(5, 7)}/${workDate.slice(0, 4)} đã trả lương – liên hệ admin` };
  }

  const { reqIn, reqOut } = requestWindow(workDate, checkInTime, checkOutTime, tz);
  if (!reqIn || !reqOut) return { error: "Giờ không hợp lệ" };
  if (reqOut.getTime() - reqIn.getTime() > 16 * 3600_000) return { error: "Một lượt làm việc không quá 16 tiếng – kiểm tra lại giờ vào / ra" };
  if (reqOut.getTime() > now.getTime() + 5 * 60_000) return { error: `Giờ ra ${checkOutTime} chưa tới – chỉ gửi cho ca đã làm xong` };
  if (kind === "MISSING" && localMonth(reqIn, tz) !== workDate.slice(0, 7) && (await isMonthLocked(user.storeId!, localMonth(reqIn, tz), user._id)))
    return { error: "Tháng này đã trả lương – liên hệ admin" };

  // không chồng lên lượt đã có (chấm bù trùng → gợi ý sửa giờ lượt đó)
  const near = await attendancesNear(user._id, reqIn, reqOut);
  const clash = findOverlap(near, reqIn, reqOut, kind === "EDIT" ? String(attendanceId) : undefined);
  if (clash) {
    const what = `${clash.shiftLabel ? `${clash.shiftLabel} ` : ""}${attText(clash, tz)} (${viDate(clash.workDate).slice(0, 5)})`;
    return kind === "MISSING"
      ? { error: `Trùng lượt đã chấm: ${what}. Không thể chấm bù chồng lên lượt đã có.`, overlapId: String(clash._id) }
      : { error: `Giờ mới chồng lên lượt khác: ${what}. Kiểm tra lại giờ vào / ra.` };
  }
  if (kind === "MISSING") {
    // đã gửi chấm bù cho khung giờ này (đang chờ duyệt) → không gửi trùng
    const pend = await AdjustmentRequest.find({ userId: user._id, kind: "MISSING", status: "PENDING", workDate }).select("workDate checkInTime checkOutTime").lean();
    for (const p of pend) {
      const w = requestWindow(p.workDate!, p.checkInTime, p.checkOutTime, tz);
      if (w.reqIn && w.reqOut && w.reqIn < reqOut && reqIn < w.reqOut) return { error: `Bạn đã gửi chấm bù ${p.checkInTime} → ${p.checkOutTime} ngày này – đang chờ duyệt` };
    }
  }

  await AdjustmentRequest.create({ userId: user._id, storeId, kind, attendanceId, before, workDate, checkInTime, checkOutTime, reason });
  // báo nhóm chấm công: loại yêu cầu + giờ app đang ghi + giờ xin + admin cần xác nhận (chạy sau khi trả kết quả cho nhân viên)
  after(() =>
    notifyAdjustment({ userId: user._id, storeId, employeeName: user.name || user.email, workDate, checkInTime, checkOutTime, reason, kind, attendanceId }),
  );
  revalidatePath("/history");
  return { ok: true };
}

/** Nhân viên huỷ yêu cầu chấm công của mình khi còn chờ duyệt (admin đang mở duyệt thì không huỷ được) */
export async function cancelAdjustment(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireActiveUser();
  const r = await AdjustmentRequest.updateOne(
    {
      _id: String(fd.get("id") || ""),
      userId: user._id,
      status: "PENDING",
      $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - 2 * 60_000) } }],
    },
    { $set: { status: "CANCELLED", resolvedAt: new Date() } },
  ).catch(() => null);
  if (!r?.modifiedCount) return { error: "Yêu cầu đã được admin xử lý – tải lại trang" };
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

/** Tài khoản → Màu giao diện: lưu theo tài khoản (đổi điện thoại vẫn giữ). Thử việc luôn màu tím – không đổi được. */
export async function setMyTheme(theme: string): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireActiveUser();
  const { isThemeId } = await import("@/lib/themes");
  if (!isThemeId(theme)) return { error: "Màu không hợp lệ" };
  if (user.probation) return { error: "Đang thử việc – app dùng màu tím thử việc, lên nhân viên chính thức là đổi được màu." };
  const { User } = await import("@/lib/models");
  await User.updateOne({ _id: user._id }, { $set: { theme } });
  revalidatePath("/", "layout");
  return { ok: true };
}
