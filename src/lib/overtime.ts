import { Types } from "mongoose";
import { Attendance, Store } from "./models";
import { computeFields, shiftBlock } from "./attendance";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { localTime, viDate } from "./time";
import { APPROVE_PERM, responsibleAdminNames } from "./admin-stores";

/*
 * Làm thêm giờ cần admin duyệt.
 * Nhân viên check-out quá giờ hết KHỐI CA ĐƯỢC XẾP (VD ca Sáng 08–16, không được xếp ca Chiều) hơn 30 phút
 * → lượt chấm công gắn overtime PENDING + báo nhóm chấm công + hiện ở admin → Yêu cầu.
 *  - Duyệt: giữ nguyên giờ công (xoá khỏi danh sách chờ).
 *  - Từ chối: giờ ra = giờ hết ca → chỉ tính công trong ca, bỏ giờ làm thêm (giờ ra thật lưu ở overtime.actualOutAt).
 * Không có ca được xếp (ngoài ca) → không xét (không có mốc hết ca).
 */

export const OVERTIME_GRACE_MIN = 30;

/** 140 → "2 tiếng 20 phút" */
export function durVi(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} tiếng` : "", m ? `${m} phút` : ""].filter(Boolean).join(" ") || "0 phút";
}

/** Lượt chấm công (đã có giờ ra) có làm thêm quá giờ hết ca > 30 phút không. */
export async function detectOvertime(att: { shiftAssignmentId?: unknown; checkOutAt?: Date | null }, tz: string) {
  if (!att.shiftAssignmentId || !att.checkOutAt) return null;
  const block = await shiftBlock(att.shiftAssignmentId as Types.ObjectId, tz);
  if (!block) return null;
  const minutes = Math.floor((att.checkOutAt.getTime() - block.end.getTime()) / 60_000);
  if (minutes <= OVERTIME_GRACE_MIN) return null;
  return { minutes, shiftEnd: block.end, shiftLabel: block.label };
}

/**
 * Sau khi nhân viên check-out: phát hiện làm thêm → gắn PENDING + ghi chú cho nhân viên.
 * Trả về { minutes, notify } – notify() gửi nhóm chấm công (gọi sau khi đã trả kết quả cho nhân viên) – hoặc null.
 */
export async function flagOvertime(attendanceId: Types.ObjectId, tz: string, info: { employeeName: string; storeId: unknown; storeName: string }) {
  const a = await Attendance.findById(attendanceId).lean();
  if (!a || a.status !== "COMPLETED" || !a.checkOutAt) return null;
  const ot = await detectOvertime(a, tz);
  if (!ot) return null;
  const hm = (d: Date) => localTime(d, tz).slice(0, 5);
  const outAt = a.checkOutAt;
  await Attendance.updateOne(
    { _id: a._id },
    {
      $set: {
        overtime: { minutes: ot.minutes, shiftEnd: ot.shiftEnd, shiftLabel: ot.shiftLabel, status: "PENDING" },
        staffNote: `Check-out ${hm(outAt)}, quá giờ hết ca ${hm(ot.shiftEnd)} ${durVi(ot.minutes)} – giờ làm thêm chờ admin xác nhận.`,
      },
    },
  );
  const notify = async () => {
    try {
      if (!telegramConfigured()) return;
      const store = await Store.findById(info.storeId).select("telegramAttendanceChatId").lean();
      const chatId = attendanceChatId(store ?? {});
      if (!chatId) return;
      // admin quản lý cơ sở này (Quản lý admin → Cơ sở quản lý) có quyền duyệt chấm công
      const admins = await responsibleAdminNames(info.storeId, APPROVE_PERM.overtime);
      await sendTelegramText(
        chatId,
        [
          "⏱ LÀM THÊM GIỜ – CẦN ADMIN XÁC NHẬN",
          `🏪 Cơ sở: ${info.storeName.replace(/^TBS\s+/i, "")}`,
          `👤 Nhân viên: ${info.employeeName}`,
          `📅 Ngày: ${viDate(a.workDate).slice(0, 5)}`,
          `⏰ Ca được xếp: ${ot.shiftLabel} · vào ${hm(a.checkInAt)} → ra ${hm(outAt)}`,
          `➕ Làm thêm ${durVi(ot.minutes)} sau giờ hết ca (không được xếp ca sau).`,
          `👉 Cần admin ${admins.join(", ")} xác nhận: vào Yêu cầu → Làm thêm giờ để Duyệt / Từ chối.`,
        ].join("\n"),
      );
    } catch (e) {
      console.error("[overtime notify]", (e as Error).message);
    }
  };
  return { minutes: ot.minutes, notify };
}

/** Từ chối: giờ ra = giờ hết ca, tính lại giờ công (bỏ giờ làm thêm). */
export async function rejectOvertimeHours(a: {
  _id: unknown;
  storeId: Types.ObjectId;
  shiftAssignmentId?: Types.ObjectId | null;
  checkInAt: Date;
  checkOutAt?: Date | null;
  extraHours?: number | null;
  overtime?: { shiftEnd?: Date | null } | null;
}) {
  const cap = a.overtime?.shiftEnd;
  if (!cap || !a.checkOutAt) throw new Error("Thiếu giờ hết ca");
  const fields = await computeFields({ storeId: a.storeId, shiftAssignmentId: a.shiftAssignmentId, checkInAt: a.checkInAt, checkOutAt: cap, extraHours: a.extraHours });
  return { fields, cap, actualOutAt: a.checkOutAt };
}
