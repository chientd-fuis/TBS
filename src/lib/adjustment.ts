import { Types } from "mongoose";
import { Attendance, Store } from "./models";
import { addDays, DEFAULT_TZ, localTime, viDate, weekdayVi, zonedToDate } from "./time";
import { minutesVi } from "./format";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { APPROVE_PERM, responsibleAdminNames } from "./admin-stores";

/*
 * Yêu cầu điều chỉnh chấm công (nhân viên gửi ở Lịch sử) → admin duyệt.
 * Ngày có thể có NHIỀU lượt (VD ca Sáng 08–12 đã xong + ca Tối 18:30 quên check-out) → phải sửa ĐÚNG lượt:
 *  1. lượt đang thiếu giờ ra (đang mở / quên check-out) có giờ vào gần giờ xin nhất
 *  2. lượt đã được tự check-out (hết ca tối) trùng khoảng giờ xin
 *  3. lượt đã xong trùng khoảng giờ xin nhiều nhất
 *  4. không trùng lượt nào → TẠO lượt mới (quên cả vào lẫn ra của ca đó)
 * Admin thấy các lượt trong ngày + lượt được chọn sẵn, đổi được trước khi duyệt.
 */

export type DayAtt = {
  _id: Types.ObjectId;
  checkInAt: Date;
  checkOutAt?: Date | null;
  status: string;
  autoCheckout?: boolean | null;
  /** bấm check-out sau giờ chốt ca tối (checkOutAt = giờ chốt) */
  actualCheckOutAt?: Date | null;
  shiftLabel?: string | null;
  roundedHours?: number | null;
  storeId: Types.ObjectId;
};

export async function dayAttendances(userId: unknown, workDate: string) {
  return (await Attendance.find({ userId, workDate })
    .select("checkInAt checkOutAt actualCheckOutAt status autoCheckout shiftLabel roundedHours storeId")
    .sort({ checkInAt: 1 })
    .lean()) as unknown as DayAtt[];
}

/** Lượt chấm công của nhân viên có thể chạm khoảng [from, to] (lùi 1 ngày cho ca qua đêm) */
export async function attendancesNear(userId: unknown, from: Date, to: Date) {
  return (await Attendance.find({ userId, checkInAt: { $gte: new Date(from.getTime() - 24 * 3600_000), $lte: to } })
    .select("checkInAt checkOutAt actualCheckOutAt status autoCheckout shiftLabel roundedHours storeId workDate")
    .sort({ checkInAt: 1 })
    .lean()) as unknown as (DayAtt & { workDate: string })[];
}

/** Lượt (khác exceptId) chồng lên khoảng [s, e): lượt quên check-out chỉ có giờ vào, lượt đang mở tính tới bây giờ */
export function findOverlap<T extends DayAtt>(list: T[], s: Date, e: Date, exceptId?: string): T | null {
  return (
    list.find((a) => {
      if (exceptId && String(a._id) === exceptId) return false;
      const as = a.checkInAt.getTime();
      const ae = a.checkOutAt ? a.checkOutAt.getTime() : a.status === "OPEN" ? Date.now() : as;
      if (ae <= as) return as >= s.getTime() && as < e.getTime();
      return Math.min(ae, e.getTime()) - Math.max(as, s.getTime()) > 0;
    }) ?? null
  );
}

/** Giờ xin (HH:mm) → Date; giờ ra ≤ giờ vào = qua đêm */
export function requestWindow(workDate: string, inTime: string | null | undefined, outTime: string | null | undefined, tz: string) {
  const reqIn = inTime ? zonedToDate(workDate, inTime, tz) : null;
  let reqOut = outTime ? zonedToDate(workDate, outTime, tz) : null;
  if (reqIn && reqOut && reqOut <= reqIn) reqOut = zonedToDate(addDays(workDate, 1), outTime!, tz);
  return { reqIn, reqOut };
}

const missingOut = (a: DayAtt) => !a.checkOutAt || a.status === "OPEN" || a.status === "MISSING_CHECKOUT";

/** Chọn lượt cần sửa (null = tạo lượt mới) */
export function pickTarget(list: DayAtt[], reqIn: Date | null, reqOut: Date | null): DayAtt | null {
  if (!list.length) return null;
  const t = (d: Date) => d.getTime();
  // 1) thiếu giờ ra: giờ vào gần giờ xin nhất (chỉ có giờ ra → lượt vào trước giờ ra, gần nhất)
  const open = list.filter(missingOut);
  if (open.length) {
    if (reqIn) return open.reduce((b, a) => (Math.abs(t(a.checkInAt) - t(reqIn)) < Math.abs(t(b.checkInAt) - t(reqIn)) ? a : b));
    if (reqOut) {
      const before = open.filter((a) => t(a.checkInAt) < t(reqOut));
      if (before.length) return before.reduce((b, a) => (t(a.checkInAt) > t(b.checkInAt) ? a : b));
    }
  }
  // khoảng giờ xin (chỉ có 1 mốc → coi như 1 điểm)
  const ws = t(reqIn ?? reqOut!);
  const we = t(reqOut ?? reqIn!);
  const overlap = (a: DayAtt) => {
    const s = t(a.checkInAt);
    const e = a.checkOutAt ? t(a.checkOutAt) : s;
    if (ws === we) return ws >= s && ws <= e ? 1 : 0; // 1 mốc: nằm trong lượt
    return Math.max(0, Math.min(e, we) - Math.max(s, ws));
  };
  const best = (xs: DayAtt[]) => xs.filter((a) => overlap(a) > 0).sort((a, b) => overlap(b) - overlap(a))[0] ?? null;
  // 2) lượt đã được tự check-out trùng giờ xin
  const auto = best(list.filter((a) => a.autoCheckout));
  if (auto) return auto;
  // 3) lượt đã xong trùng giờ xin nhiều nhất
  return best(list.filter((a) => !missingOut(a)));
}

/** "vào 18:30 → tự check-out 23:00 · 4,5h" */
export function attText(a: DayAtt, tz: string) {
  const hm = (d: Date) => localTime(d, tz).slice(0, 5);
  const out = a.checkOutAt
    ? `${a.autoCheckout ? "tự check-out" : "ra"} ${hm(a.checkOutAt)}${a.actualCheckOutAt ? ` (bấm ${hm(a.actualCheckOutAt)}, công tính tới giờ chốt)` : ""}`
    : a.status === "MISSING_CHECKOUT"
      ? "quên check-out"
      : "đang làm, chưa check-out";
  return `vào ${hm(a.checkInAt)} → ${out}${a.roundedHours ? ` · ${String(a.roundedHours).replace(".", ",")}h` : ""}`;
}

/**
 * Nhân viên vừa gửi yêu cầu điều chỉnh → báo nhóm chấm công của cơ sở: giờ xin, giờ app đang ghi, cảnh báo, admin cần xác nhận.
 * Không ném lỗi (yêu cầu vẫn được lưu nếu Telegram lỗi).
 */
export async function notifyAdjustment(r: {
  userId: unknown;
  storeId: unknown;
  employeeName: string;
  workDate: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  reason: string;
  /** MISSING = chấm bù cả ca · EDIT = sửa giờ lượt attendanceId · trống = yêu cầu kiểu cũ */
  kind?: "MISSING" | "EDIT";
  attendanceId?: unknown;
}) {
  try {
    if (!telegramConfigured()) return;
    const store = await Store.findById(r.storeId).select("name timezone telegramAttendanceChatId").lean();
    if (!store) return;
    const chatId = attendanceChatId(store);
    if (!chatId) return;
    const tz = store.timezone || DEFAULT_TZ;
    const list = await dayAttendances(r.userId, r.workDate);
    const { reqIn, reqOut } = requestWindow(r.workDate, r.checkInTime, r.checkOutTime, tz);
    // sửa giờ: đúng lượt nhân viên đã chọn · chấm bù: không có lượt (thêm mới) · kiểu cũ: đoán theo giờ
    const target = r.kind === "EDIT" ? (list.find((a) => String(a._id) === String(r.attendanceId)) ?? null) : r.kind === "MISSING" ? null : pickTarget(list, reqIn, reqOut);
    const admins = await responsibleAdminNames(r.storeId, APPROVE_PERM.adjustment);
    const day = `📅 Ngày: ${viDate(r.workDate).slice(0, 5)} (${weekdayVi(r.workDate)})`;
    const head = [`🏪 Cơ sở: ${store.name.replace(/^TBS\s+/i, "")}`, `👤 Nhân viên: ${r.employeeName}`];
    const tail = [`💬 Lý do: ${r.reason}`, `👉 Cần admin ${admins.join(", ")} xác nhận: vào Yêu cầu để Duyệt / Từ chối.`];
    const appDay = list.length ? list.map((a) => `${a.shiftLabel ? `${a.shiftLabel} · ` : ""}${attText(a, tz)}`).join("; ") : "không có lượt nào";
    const text = (
      r.kind === "EDIT"
        ? [
            "✏️ YÊU CẦU SỬA GIỜ CHẤM CÔNG",
            ...head,
            `${day}${target?.shiftLabel ? ` · ${target.shiftLabel}` : ""}`,
            `📱 App ghi: ${target ? attText(target, tz) : "lượt không còn"}`,
            `✍️ Xin sửa: vào ${r.checkInTime || "--"} → ra ${r.checkOutTime || "--"}`,
            ...(target ? compareWarnings(target, reqIn, reqOut).map((w) => `⚠️ ${w}`) : []),
            ...tail,
          ]
        : r.kind === "MISSING"
          ? [
              "🆕 YÊU CẦU CHẤM BÙ CA (quên chấm công)",
              ...head,
              day,
              `✍️ Xin thêm lượt: vào ${r.checkInTime} → ra ${r.checkOutTime}`,
              `📱 Ngày này app đã có: ${appDay}`,
              ...tail,
            ]
          : [
              "📝 YÊU CẦU ĐIỀU CHỈNH CHẤM CÔNG",
              ...head,
              day,
              `✍️ Xin: vào ${r.checkInTime || "--"} → ra ${r.checkOutTime || "--"}`,
              `📱 App ghi: ${target ? `${target.shiftLabel ? `${target.shiftLabel} · ` : ""}${attText(target, tz)}` : list.length ? `${list.length} lượt khác giờ – sẽ thêm lượt mới` : "không có lượt nào"}`,
              ...compareWarnings(target, reqIn, reqOut).map((w) => `⚠️ ${w}`),
              ...tail,
            ]
    ).join("\n");
    await sendTelegramText(chatId, text);
  } catch (e) {
    console.error("[notifyAdjustment]", (e as Error).message);
  }
}

/** Cảnh báo so với lượt app đã ghi: xin giờ vào sớm hơn / giờ ra muộn hơn */
export function compareWarnings(a: DayAtt | null, reqIn: Date | null, reqOut: Date | null) {
  const out: string[] = [];
  if (!a) {
    out.push("App không có lượt nào trùng giờ này – duyệt sẽ TẠO lượt chấm công mới");
    return out;
  }
  const min = (ms: number) => Math.round(ms / 60_000);
  if (reqIn) {
    const d = min(a.checkInAt.getTime() - reqIn.getTime());
    if (d >= 5) out.push(`Xin giờ vào SỚM hơn app ghi ${minutesVi(d)} (mất cảnh báo đi muộn, thêm giờ công)`);
    else if (d <= -5) out.push(`Xin giờ vào muộn hơn app ghi ${minutesVi(-d)}`);
  }
  if (reqOut && a.checkOutAt) {
    const d = min(reqOut.getTime() - a.checkOutAt.getTime());
    if (d >= 5) out.push(`Xin giờ ra MUỘN hơn app ghi ${minutesVi(d)} (thêm giờ công)`);
    else if (d <= -5) out.push(`Xin giờ ra sớm hơn app ghi ${minutesVi(-d)}`);
  }
  return out;
}
