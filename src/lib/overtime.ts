import { Types } from "mongoose";
import { Attendance, Store } from "./models";
import { computeFields, shiftBlock } from "./attendance";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { localTime, viDate, weekdayVi } from "./time";
import { APPROVE_PERM, responsibleAdminNames } from "./admin-stores";
import { getSettings } from "./settings";
import { roundedHours } from "./calc";

/*
 * LÀM NGOÀI GIỜ cần admin xác nhận – MẶC ĐỊNH VẪN TÍNH CÔNG, admin Từ chối thì bỏ đúng phần ngoài giờ.
 * Xét khi nhân viên check-out (và khi admin duyệt yêu cầu điều chỉnh có giờ ra):
 *  - Ra muộn: check-out quá giờ hết KHỐI CA ĐƯỢC XẾP hơn 30 phút (VD ca Sáng 08–16, không được xếp ca Chiều).
 *  - Vào sớm: check-in trước giờ bắt đầu ca mà phần vào sớm làm TĂNG giờ công
 *    (VD ca 14:00–18:00, vào 13:30 ra 18:25 → 4,5h thay vì 4h). Vào sớm vài phút không đổi giờ công → không báo.
 *  - Ngoài ca: lượt không có ca được xếp (hoặc vào sớm hơn 3 tiếng nên không gắn được ca) → cả lượt.
 * Duyệt: giữ nguyên giờ công. Từ chối: giờ vào = đầu ca / giờ ra = hết ca / ngoài ca = 0 giờ (giờ thật lưu ở actualInAt / actualOutAt).
 * Lượt đang chờ vẫn được cộng vào bảng lương → Bảng lương cảnh báo "cần kiểm duyệt" (admin/payroll).
 */

export const OVERTIME_GRACE_MIN = 30;

/** 140 → "2 tiếng 20 phút" */
export function durVi(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} tiếng` : "", m ? `${m} phút` : ""].filter(Boolean).join(" ") || "0 phút";
}

/** 0.5 → "0,5h" */
export const hoursShort = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")}h`;

export type ExtraTime = {
  minutes: number;
  earlyInMinutes: number;
  outOfShift: boolean;
  deltaHours: number;
  shiftStart?: Date;
  shiftEnd?: Date;
  shiftLabel?: string;
};
type ExtraLike = {
  minutes?: number | null;
  earlyInMinutes?: number | null;
  outOfShift?: boolean | null;
  shiftStart?: Date | null;
  shiftEnd?: Date | null;
};

async function roundCfg() {
  const s = await getSettings();
  return { stepHours: s.roundStepHours, graceMinutes: s.roundGraceMinutes, graceHourMinutes: s.roundGraceHourMinutes ?? s.roundGraceMinutes };
}

/** Giờ vào / ra được tính nếu admin TỪ CHỐI phần ngoài giờ */
export function rejectedWindow(a: { checkInAt: Date; checkOutAt: Date }, ot: ExtraLike) {
  if (ot.outOfShift) return { inAt: a.checkInAt, outAt: a.checkInAt }; // ngoài ca → 0 giờ
  const outAt = ot.minutes && ot.shiftEnd ? ot.shiftEnd : a.checkOutAt;
  let inAt = ot.earlyInMinutes && ot.shiftStart ? ot.shiftStart : a.checkInAt;
  if (inAt > outAt) inAt = outAt; // ra trước cả giờ bắt đầu ca
  return { inAt, outAt };
}

/** ["Vào sớm 30 phút trước giờ ca", "Ra muộn 1 tiếng sau giờ hết ca"] / ["Làm ngoài ca (không được xếp ca)"] */
export function extraKinds(ot: ExtraLike) {
  if (ot.outOfShift) return ["Làm ngoài ca (không được xếp ca)"];
  return [
    ot.earlyInMinutes ? `Vào sớm ${durVi(ot.earlyInMinutes)} trước giờ ca` : "",
    ot.minutes ? `Ra muộn ${durVi(ot.minutes)} sau giờ hết ca` : "",
  ].filter(Boolean);
}

/** Lượt chấm công (đã có giờ ra) có giờ ngoài giờ làm tăng giờ công không. */
export async function detectOvertime(att: { shiftAssignmentId?: unknown; checkInAt: Date; checkOutAt?: Date | null }, tz: string): Promise<ExtraTime | null> {
  if (!att.checkOutAt) return null;
  const cfg = await roundCfg();
  const full = roundedHours(att.checkInAt, att.checkOutAt, cfg);
  if (full <= 0) return null;
  const block = att.shiftAssignmentId ? await shiftBlock(att.shiftAssignmentId as Types.ObjectId, tz) : null;
  if (!block) return { minutes: 0, earlyInMinutes: 0, outOfShift: true, deltaHours: full };
  const lateOut = Math.floor((att.checkOutAt.getTime() - block.end.getTime()) / 60_000);
  const minutes = lateOut > OVERTIME_GRACE_MIN ? lateOut : 0;
  const early = Math.floor((block.start.getTime() - att.checkInAt.getTime()) / 60_000);
  // vào sớm chỉ tính là ngoài giờ khi làm tăng giờ công so với tính từ đầu ca
  const fromStart = new Date(Math.min(block.start.getTime(), att.checkOutAt.getTime()));
  const earlyInMinutes = early > 0 && full > roundedHours(fromStart, att.checkOutAt, cfg) ? early : 0;
  if (!minutes && !earlyInMinutes) return null;
  const w = rejectedWindow({ checkInAt: att.checkInAt, checkOutAt: att.checkOutAt }, { minutes, earlyInMinutes, shiftStart: block.start, shiftEnd: block.end });
  const deltaHours = Math.round((full - roundedHours(w.inAt, w.outAt, cfg)) * 100) / 100;
  if (deltaHours <= 0) return null; // không làm thay đổi giờ công (VD đi muộn rồi ra muộn) → không cần duyệt
  return { minutes, earlyInMinutes, outOfShift: false, deltaHours, shiftStart: block.start, shiftEnd: block.end, shiftLabel: block.label };
}

/**
 * Sau khi nhân viên check-out (hoặc admin duyệt yêu cầu điều chỉnh): phát hiện ngoài giờ → gắn PENDING + ghi chú cho nhân viên.
 * Trả về { minutes, staffText, notify } – notify() gửi nhóm chấm công (gọi sau khi đã trả kết quả cho nhân viên) – hoặc null.
 */
export async function flagOvertime(attendanceId: Types.ObjectId, tz: string, info: { employeeName: string; storeId: unknown; storeName: string }) {
  const a = await Attendance.findById(attendanceId).lean();
  if (!a || a.status !== "COMPLETED" || !a.checkOutAt) return null;
  const ot = await detectOvertime(a, tz);
  if (!ot) return null;
  const hm = (d: Date) => localTime(d, tz).slice(0, 5);
  const outAt = a.checkOutAt;
  const kinds = extraKinds(ot);
  const staffText = `${kinds.join(" · ")} – +${hoursShort(ot.deltaHours)} công ngoài giờ chờ admin xác nhận (mặc định vẫn tính).`;
  await Attendance.updateOne(
    { _id: a._id },
    {
      $set: {
        overtime: {
          minutes: ot.minutes,
          earlyInMinutes: ot.earlyInMinutes,
          outOfShift: ot.outOfShift,
          deltaHours: ot.deltaHours,
          shiftStart: ot.shiftStart,
          shiftEnd: ot.shiftEnd,
          shiftLabel: ot.shiftLabel,
          status: "PENDING",
        },
        staffNote: staffText,
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
          ot.outOfShift ? "⏱ LÀM NGOÀI CA – CẦN ADMIN XÁC NHẬN" : "⏱ LÀM NGOÀI GIỜ – CẦN ADMIN XÁC NHẬN",
          `🏪 Cơ sở: ${info.storeName.replace(/^TBS\s+/i, "")}`,
          `👤 Nhân viên: ${info.employeeName}`,
          `📅 Ngày: ${viDate(a.workDate).slice(0, 5)} (${weekdayVi(a.workDate)})`,
          ot.outOfShift
            ? `⏰ Không được xếp ca · vào ${hm(a.checkInAt)} → ra ${hm(outAt)}`
            : `⏰ Ca được xếp: ${ot.shiftLabel} · vào ${hm(a.checkInAt)} → ra ${hm(outAt)}`,
          ...kinds.map((k) => `➕ ${k}`),
          `💰 Đang tính +${hoursShort(ot.deltaHours)} công ngoài giờ – mặc định vẫn tính, Từ chối thì bỏ phần này.`,
          `👉 Cần admin ${admins.join(", ")} xác nhận: vào Yêu cầu → Làm ngoài giờ để Duyệt / Từ chối.`,
        ].join("\n"),
      );
    } catch (e) {
      console.error("[overtime notify]", (e as Error).message);
    }
  };
  return { minutes: ot.minutes, staffText, notify };
}

/** Từ chối: bỏ phần ngoài giờ (giờ vào = đầu ca / giờ ra = hết ca / ngoài ca = 0 giờ), tính lại giờ công. */
export async function rejectOvertimeHours(a: {
  storeId: Types.ObjectId;
  shiftAssignmentId?: Types.ObjectId | null;
  checkInAt: Date;
  checkOutAt?: Date | null;
  extraHours?: number | null;
  overtime?: ExtraLike | null;
}) {
  if (!a.checkOutAt || !a.overtime) throw new Error("Thiếu giờ ra");
  const { inAt, outAt } = rejectedWindow({ checkInAt: a.checkInAt, checkOutAt: a.checkOutAt }, a.overtime);
  const fields = await computeFields({ storeId: a.storeId, shiftAssignmentId: a.shiftAssignmentId, checkInAt: inAt, checkOutAt: outAt, extraHours: a.extraHours });
  return { fields, inAt, outAt };
}
