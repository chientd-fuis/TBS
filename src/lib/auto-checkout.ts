import { connectDB } from "./db";
import { Attendance, Settings, Store, User } from "./models";
import { computeFields, isMonthLocked, payStoreOf, shiftBlock } from "./attendance";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { addDays, DEFAULT_TZ, localDate, localTime, viDate, zonedToDate } from "./time";

/*
 * Tự động check-out khi hết ca tối (bật riêng từng cơ sở ở Cài đặt → Cấu hình chấm công).
 * Tới giờ autoCheckoutTime (VD 23:00) mà nhân viên ở cơ sở đó vẫn đang trong ca → hệ thống check-out ĐÚNG giờ đó
 * (giờ ra = 23:00 dù lúc xử lý có trễ) + báo nhóm chấm công Telegram 1 tin liệt kê các nhân viên.
 *
 * Chỉ check-out người ĐƯỢC XẾP CA TỐI: lượt chấm công gắn với ca được xếp mà khối ca liền (VD Chiều + Tối) kết thúc
 * ≥ giờ check-out − 60 phút. VD: A ca Chiều+Tối, B ca Tối → tự check-out 23:00; C ca Sáng+Chiều, D ca Chiều quên check-out
 * → KHÔNG check-out (vẫn đi luồng "quên check-out"); người không có ca được xếp → không tự check-out.
 *
 * Sau khi tự check-out: khoá chấm công 2 tiếng (nút CHECK-OUT mờ + báo "đã tự động check-out"); ngoài ra có
 * giờ cấm check-in (mặc định 01:00–06:00, Cài đặt) – xem checkinLock().
 *
 * Chạy: cron 23h (vercel.json), cron đêm (trước bước đánh dấu quên check-out), và kèm khi có người mở app (giới hạn 3 phút / lần).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHIFT_END_SLACK_MS = 60 * 60_000;
/** sau khi tự check-out: khoá nút chấm công bao lâu */
export const AUTO_LOCK_MS = 2 * 3600_000;
const hm = (d: Date, tz: string) => localTime(d, tz).slice(0, 5);
const h = (n?: number | null) => (n == null ? "" : `${String(n).replace(".", ",")}h`);

export const isAutoCheckoutTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);

export async function runAutoCheckout(now = new Date()) {
  await connectDB();
  const stores = await Store.find({ autoCheckoutOn: true, active: { $ne: false } }).select("name timezone autoCheckoutTime telegramAttendanceChatId").lean();
  let done = 0;
  for (const s of stores) {
    const tz = s.timezone || DEFAULT_TZ;
    const time = isAutoCheckoutTime(s.autoCheckoutTime) ? s.autoCheckoutTime : "23:00";
    const opens = await Attendance.find({ storeId: s._id, status: "OPEN" }).lean();
    const out: { name: string; inAt: Date; outAt: Date; hours: number | null | undefined; workDate: string }[] = [];
    const missed: { name: string; inAt: Date; shift: string; workDate: string }[] = [];
    for (const a of opens) {
      // giờ check-out của ngày làm đó (giờ check-out sau nửa đêm, VD 00:30 → sang ngày hôm sau)
      let cutoff = zonedToDate(a.workDate, time, tz);
      if (cutoff <= a.checkInAt) cutoff = zonedToDate(addDays(a.workDate, 1), time, tz);
      if (now < cutoff) continue;
      if (await isMonthLocked(payStoreOf(a), a.month, a.userId)) continue;
      // chỉ người được xếp ca tối (khối ca liền kết thúc sát giờ check-out) mới được tự check-out
      const block = a.shiftAssignmentId ? await shiftBlock(a.shiftAssignmentId, tz) : null;
      if (!block || block.end.getTime() < cutoff.getTime() - SHIFT_END_SLACK_MS) {
        // không được xếp ca tối (VD ca Sáng + Chiều, ca Chiều) mà còn trong ca tới giờ này → QUÊN CHECK-OUT, không tự check-out
        const r = await Attendance.updateOne(
          { _id: a._id, status: "OPEN" },
          {
            $set: {
              status: "MISSING_CHECKOUT",
              missedCheckout: true,
              cutoffMissingAt: cutoff,
              note: [a.note, `Quá giờ check-out ${time} – ghi quên check-out`].filter(Boolean).join(" | "),
              staffNote: a.staffNote || `Bạn quên check-out – quá ${time} hệ thống ghi QUÊN CHECK-OUT (chưa tính giờ ra). Gửi yêu cầu bổ sung giờ ở Lịch sử.`,
            },
          },
        );
        if (r.modifiedCount) {
          const u = await User.findById(a.userId).select("name email").lean();
          missed.push({ name: u?.name || u?.email || "?", inAt: a.checkInAt, shift: a.shiftLabel || "ngoài ca", workDate: a.workDate });
        }
        continue;
      }
      const fields = await computeFields({ storeId: a.storeId, shiftAssignmentId: a.shiftAssignmentId, checkInAt: a.checkInAt, checkOutAt: cutoff, extraHours: a.extraHours });
      const updated = await Attendance.findOneAndUpdate(
        { _id: a._id, status: "OPEN" }, // nhân viên vừa tự bấm check-out cùng lúc → không ghi đè
        {
          $set: {
            ...fields,
            checkOutAt: cutoff,
            status: "COMPLETED",
            autoCheckout: true,
            note: [a.note, `Tự động check-out lúc ${time} (hết ca tối)`].filter(Boolean).join(" | "),
            staffNote: a.staffNote || `Hệ thống tự check-out lúc ${time} do hết ca tối – nếu sai giờ, gửi yêu cầu bổ sung.`,
          },
        },
        { returnDocument: "after" },
      ).lean();
      if (!updated) continue;
      const u = await User.findById(a.userId).select("name email").lean();
      out.push({ name: u?.name || u?.email || "?", inAt: a.checkInAt, outAt: cutoff, hours: updated.roundedHours, workDate: a.workDate });
      done++;
    }
    if (out.length || missed.length) await notifyAutoCheckout(s, tz, time, out, missed);
  }
  return { done };
}

/** 1 tin vào nhóm chấm công của cơ sở: ai được tự check-out (ca tối) + ai bị ghi quên check-out. Không ném lỗi. */
async function notifyAutoCheckout(
  store: { name: string; telegramAttendanceChatId?: string | null },
  tz: string,
  time: string,
  list: { name: string; inAt: Date; outAt: Date; hours: number | null | undefined; workDate: string }[],
  missed: { name: string; inAt: Date; shift: string; workDate: string }[],
) {
  try {
    if (!telegramConfigured()) return;
    const chatId = attendanceChatId(store);
    if (!chatId) return;
    const day = (list[0] ?? missed[0]).workDate;
    const text = [
      list.length ? "🤖 TỰ ĐỘNG CHECK-OUT" : "⏰ HẾT GIỜ CHECK-OUT",
      `🏪 Cơ sở: ${store.name.replace(/^TBS\s+/i, "")}`,
      `📅 Ngày: ${viDate(day).slice(0, 5)} · hết ca tối ${time}`,
      ...(list.length
        ? [`Có ${list.length} nhân viên chưa check-out đã được hệ thống tự check-out:`, ...list.map((x) => `• ${x.name}: vào ${hm(x.inAt, tz)} → ra ${hm(x.outAt, tz)}${x.hours != null ? ` · ${h(x.hours)} công` : ""}`)]
        : []),
      ...(missed.length
        ? [`⚠️ ${missed.length} nhân viên không làm ca tối nhưng quên check-out → ghi QUÊN CHECK-OUT (không tự check-out):`, ...missed.map((x) => `• ${x.name}: vào ${hm(x.inAt, tz)} · ca ${x.shift}`)]
        : []),
    ].join("\n");
    await sendTelegramText(chatId, text);
  } catch (e) {
    console.error("[autoCheckout notify]", (e as Error).message);
  }
}

/* ---------- Khoá nút chấm công ---------- */

export type CheckinLock = {
  kind: "auto" | "quiet";
  /** nút hiển thị (mờ, không bấm được) */
  button: "CHECK-OUT" | "CHECK-IN";
  message: string;
  /** hết khoá lúc (ISO) – app tự tải lại trạng thái */
  until: string;
};

/** "HH:mm" hiện tại có nằm trong khoảng [from, to) không (hỗ trợ khoảng qua nửa đêm, VD 23:30–06:00) */
export function inWindow(t: string, from: string, to: string) {
  return from <= to ? t >= from && t < to : t >= from || t < to;
}

/**
 * Nhân viên KHÔNG có lượt đang mở → có bị khoá chấm công không:
 *  1. vừa được tự check-out / bị ghi quên check-out lúc hết giờ (≤ 2 tiếng): khoá, nút CHECK-OUT mờ + lý do;
 *  2. giờ cấm check-in (Cài đặt, mặc định 01:00–06:00): khoá, nút CHECK-IN mờ.
 */
export async function checkinLock(userId: unknown, tz: string, now = new Date()): Promise<CheckinLock | null> {
  await connectDB();
  const since = new Date(now.getTime() - AUTO_LOCK_MS);
  const auto = await Attendance.findOne({
    userId,
    $or: [
      { autoCheckout: true, checkOutAt: { $gt: since, $lte: now } }, // vừa được tự check-out (ca tối)
      { cutoffMissingAt: { $gt: since, $lte: now } }, // quá giờ check-out cuối ngày → ghi quên check-out
    ],
  })
    .sort({ updatedAt: -1 })
    .select("checkOutAt cutoffMissingAt storeId autoCheckout")
    .lean();
  const at = auto?.autoCheckout && auto.checkOutAt ? auto.checkOutAt : auto?.cutoffMissingAt;
  if (auto && at) {
    const st = await Store.findById(auto.storeId).select("timezone").lean();
    const t = hm(at, st?.timezone || tz);
    return {
      kind: "auto",
      button: "CHECK-OUT",
      message: auto.autoCheckout
        ? `Bạn đã được hệ thống tự động check-out lúc ${t} (hết ca tối). Sai giờ thì gửi yêu cầu bổ sung ở Lịch sử.`
        : `Đã quá giờ check-out (${t}) – lượt chấm công này ghi QUÊN CHECK-OUT, không check-out được nữa. Gửi yêu cầu bổ sung giờ ra ở Lịch sử.`,
      until: new Date(at.getTime() + AUTO_LOCK_MS).toISOString(),
    };
  }
  const s = await Settings.findOne({ key: "main" }).select("quietCheckinOn quietCheckinFrom quietCheckinTo").lean();
  const on = s?.quietCheckinOn !== false; // mặc định bật
  const from = isAutoCheckoutTime(s?.quietCheckinFrom) ? s!.quietCheckinFrom! : "01:00";
  const to = isAutoCheckoutTime(s?.quietCheckinTo) ? s!.quietCheckinTo! : "06:00";
  if (on && from !== to && inWindow(hm(now, tz), from, to)) {
    let end = zonedToDate(localDate(now, tz), to, tz);
    if (end <= now) end = zonedToDate(addDays(localDate(now, tz), 1), to, tz);
    return {
      kind: "quiet",
      button: "CHECK-IN",
      message: `Ngoài giờ chấm công: không check-in từ ${from} đến ${to}. Mở lại lúc ${to}.`,
      until: end.toISOString(),
    };
  }
  return null;
}

let lastRun = 0;
/** Chạy kèm khi có người mở app / trang quản lý – tối đa 1 lần / 3 phút mỗi máy chủ, không ném lỗi. */
export async function maybeRunAutoCheckout() {
  if (Date.now() - lastRun < 3 * 60_000) return;
  lastRun = Date.now();
  await runAutoCheckout().catch((e: Error) => console.error("[autoCheckout]", e.message));
}
