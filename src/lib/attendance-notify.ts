import { minutesVi } from "./format";
import { Store } from "./models";
import { sendPhotosToTelegram, sendTelegramText, telegramConfigured } from "./telegram";
import { localTime, viDate, weekdayVi } from "./time";

/* Thông báo chấm công vào NHÓM CHẤM CÔNG trên Telegram (khác nhóm chốt ca). */

export type AttendanceNotice = {
  action: "CHECK_IN" | "CHECK_OUT";
  storeName: string;
  employeeName: string;
  tz: string;
  workDate: string; // YYYY-MM-DD
  checkInAt: Date;
  checkOutAt?: Date | null;
  shiftLabel?: string | null; // ca được xếp, VD "S 08:00–13:00"
  outOfShift?: boolean | null;
  lateMinutes?: number | null;
  earlyMinutes?: number | null;
  totalHours?: number | null;
  roundedHours?: number | null;
  supportFrom?: string | null; // nhân viên cơ sở khác sang hỗ trợ
  /** check-out sau giờ chốt công ca tối: giờ bấm thật (checkOutAt = giờ chốt) */
  actualCheckOutAt?: Date | null;
};

const hhmm = (d: Date, tz: string) => localTime(d, tz).slice(0, 5);
const h = (n?: number | null) => (n == null ? "" : `${String(n).replace(".", ",")}h`);

/** Nội dung tin nhắn (thuần – có unit test). */
export function formatAttendanceCaption(n: AttendanceNotice) {
  const warn: string[] = [];
  if (n.action === "CHECK_IN" && n.lateMinutes) warn.push(`⚠️ Đi muộn ${minutesVi(n.lateMinutes)}`);
  if (n.action === "CHECK_OUT" && n.earlyMinutes) warn.push(`⚠️ Về sớm ${minutesVi(n.earlyMinutes)}`);
  if (n.action === "CHECK_OUT" && n.lateMinutes) warn.push(`(Đi muộn ${minutesVi(n.lateMinutes)})`);
  if (n.outOfShift) warn.push("⚠️ Ngoài ca (không có ca được xếp)");
  if (n.action === "CHECK_OUT" && n.actualCheckOutAt && n.checkOutAt)
    warn.push(`⏱️ Bấm check-out lúc ${hhmm(n.actualCheckOutAt, n.tz)} – chỉ tính công tới ${hhmm(n.checkOutAt, n.tz)} (giờ chốt ca tối)`);
  return [
    n.action === "CHECK_IN" ? "✅ CHECK-IN" : "🏁 CHECK-OUT",
    `🏪 Cơ sở: ${n.storeName.replace(/^TBS\s+/i, "")}`,
    `👤 Nhân viên: ${n.employeeName}${n.supportFrom ? ` (hỗ trợ từ ${n.supportFrom.replace(/^TBS\s+/i, "")})` : ""}`,
    `📅 Ngày: ${viDate(n.workDate).slice(0, 5)} (${weekdayVi(n.workDate)})`,
    n.checkOutAt
      ? `🕐 Vào: ${hhmm(n.checkInAt, n.tz)} · Ra: ${hhmm(n.checkOutAt, n.tz)}${n.roundedHours != null ? ` · ${h(n.roundedHours)} công` : ""}`
      : `🕐 Vào: ${hhmm(n.checkInAt, n.tz)}`,
    n.shiftLabel ? `⏰ Ca: ${n.shiftLabel}` : "",
    ...warn,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Nhóm chấm công của cơ sở (trống → TELEGRAM_ATTENDANCE_CHAT_ID). */
export function attendanceChatId(store: { telegramAttendanceChatId?: string | null }) {
  return store.telegramAttendanceChatId || process.env.TELEGRAM_ATTENDANCE_CHAT_ID || "";
}

/** Gửi thông báo (ảnh check-in/out + nội dung). Không ném lỗi – chấm công vẫn thành công nếu Telegram lỗi. */
export async function notifyAttendance(storeId: unknown, n: AttendanceNotice, photo?: Buffer | null) {
  try {
    if (!telegramConfigured()) return;
    const store = await Store.findById(storeId).select("telegramAttendanceChatId").lean();
    const chatId = attendanceChatId(store ?? {});
    if (!chatId) return;
    const caption = formatAttendanceCaption(n);
    if (photo?.length) await sendPhotosToTelegram(chatId, [photo], caption);
    else await sendTelegramText(chatId, caption);
  } catch (e) {
    console.error("[notifyAttendance]", (e as Error).message);
  }
}
