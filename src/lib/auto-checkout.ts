import { connectDB } from "./db";
import { Attendance, Settings, Store, User } from "./models";
import { isMonthLocked, payStoreOf, shiftBlock } from "./attendance";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { addDays, DEFAULT_TZ, localDate, localTime, viDate, weekdayVi, zonedToDate } from "./time";

/*
 * CHỐT GIỜ CÔNG CA TỐI (bật riêng từng cơ sở ở Cài đặt → Cấu hình chấm công, giờ autoCheckoutTime – VD 23:00).
 * KHÔNG tự check-out hộ (tránh lỗ hổng nhân viên về sớm, không bấm mà vẫn đủ công) – nhân viên VẪN PHẢI tự check-out:
 *  - Người ĐƯỢC XẾP CA TỐI (khối ca liền kết thúc ≥ giờ chốt − 60 phút, VD A ca Chiều+Tối, B ca Tối):
 *      · check-out trước 23:00 → tính theo giờ bấm;
 *      · check-out sau 23:00 (tới 01:00) → chỉ tính công tới 23:00 (giờ bấm thật lưu ở actualCheckOutAt) – xem checkoutCap();
 *      · tới 01:00 (23:00 + 2 tiếng) vẫn chưa check-out → ghi QUÊN CHECK-OUT (không tính công, phải gửi yêu cầu điều chỉnh).
 *  - Người KHÔNG được xếp ca tối (VD C ca Sáng+Chiều, D ca Chiều, người ngoài ca) còn trong ca lúc 23:00 → ghi QUÊN CHECK-OUT ngay (không check-out được nữa).
 *  Báo nhóm chấm công Telegram GỘP 1 tin lúc 01:00: tất cả người quên check-out trong ngày – xem reportMissedCheckouts().
 *  Sau khi bị ghi: khoá nút 2 tiếng + giờ cấm check-in (mặc định 01:00–06:00) – xem checkinLock().
 *
 * Chạy: cron 23h + cron đêm 01:00 (vercel.json), khi nhân viên bấm chấm công / mở trang chủ, và kèm khi có người mở app (3 phút / lần).
 */

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const SHIFT_END_SLACK_MS = 60 * 60_000;
/** ca tối: được check-out muộn tới giờ chốt + 2 tiếng (công vẫn chỉ tính tới giờ chốt); khoá nút sau khi ghi quên check-out cũng 2 tiếng */
export const AUTO_LOCK_MS = 2 * 3600_000;
const hm = (d: Date, tz: string) => localTime(d, tz).slice(0, 5);

export const isAutoCheckoutTime = (v: unknown): v is string => typeof v === "string" && TIME_RE.test(v);

/** Giờ chốt công của lượt chấm công (giờ chốt sau nửa đêm, VD 00:30 → ngày hôm sau) */
function cutoffOf(a: { workDate: string; checkInAt: Date }, time: string, tz: string) {
  let cutoff = zonedToDate(a.workDate, time, tz);
  if (cutoff <= a.checkInAt) cutoff = zonedToDate(addDays(a.workDate, 1), time, tz);
  return cutoff;
}

/**
 * Nhân viên bấm check-out: cơ sở bật chốt công ca tối và đã quá giờ chốt → giờ ra tính công = giờ chốt (VD 23:00).
 * null = không giới hạn (tính theo giờ bấm).
 */
export async function checkoutCap(a: { storeId: unknown; workDate: string; checkInAt: Date }, now = new Date()) {
  const s = await Store.findById(a.storeId).select("autoCheckoutOn autoCheckoutTime timezone").lean();
  if (!s?.autoCheckoutOn) return null;
  const time = isAutoCheckoutTime(s.autoCheckoutTime) ? s.autoCheckoutTime : "23:00";
  const cutoff = cutoffOf(a, time, s.timezone || DEFAULT_TZ);
  return now > cutoff ? { cap: cutoff, time } : null;
}

export async function runAutoCheckout(now = new Date()) {
  await connectDB();
  const stores = await Store.find({ autoCheckoutOn: true, active: { $ne: false } }).select("name timezone autoCheckoutTime telegramAttendanceChatId").lean();
  let done = 0;
  for (const s of stores) {
    const tz = s.timezone || DEFAULT_TZ;
    const time = isAutoCheckoutTime(s.autoCheckoutTime) ? s.autoCheckoutTime : "23:00";
    const opens = await Attendance.find({ storeId: s._id, status: "OPEN" }).lean();
    for (const a of opens) {
      const cutoff = cutoffOf(a, time, tz);
      if (now < cutoff) continue;
      // ca tối: còn được tự check-out tới giờ chốt + 2 tiếng; ca khác: quá giờ chốt là hết
      const block = a.shiftAssignmentId ? await shiftBlock(a.shiftAssignmentId, tz) : null;
      const evening = !!block && block.end.getTime() >= cutoff.getTime() - SHIFT_END_SLACK_MS;
      const deadline = evening ? new Date(cutoff.getTime() + AUTO_LOCK_MS) : cutoff;
      if (now < deadline) continue;
      if (await isMonthLocked(payStoreOf(a), a.month, a.userId)) continue;
      const r = await Attendance.updateOne(
        { _id: a._id, status: "OPEN" }, // nhân viên vừa tự bấm check-out cùng lúc → không ghi đè
        {
          $set: {
            status: "MISSING_CHECKOUT",
            missedCheckout: true,
            missedNotified: false, // báo gộp lúc giờ chốt + 2 tiếng – reportMissedCheckouts()
            cutoffMissingAt: deadline,
            note: [a.note, evening ? `Không check-out trước ${hm(deadline, tz)} – ghi quên check-out` : `Quá giờ check-out ${time} – ghi quên check-out`]
              .filter(Boolean)
              .join(" | "),
            staffNote:
              a.staffNote ||
              `Bạn quên check-out – quá ${hm(deadline, tz)} hệ thống ghi QUÊN CHECK-OUT (chưa tính giờ công lượt này). Gửi yêu cầu điều chỉnh giờ ra ở Lịch sử.`,
          },
        },
      );
      if (r.modifiedCount) done++;
    }
  }
  const reported = await reportMissedCheckouts(now);
  return { done, reported };
}

/**
 * Báo GỘP 1 tin / cơ sở / ngày vào nhóm chấm công lúc giờ chốt + 2 tiếng (VD 01:00): TẤT CẢ lượt quên check-out của ngày đó
 * – ca khác (C, D) bị ghi lúc 23:00, ca tối không check-out trước 01:00, lượt bị ghi quên trong ngày. Mỗi lượt chỉ báo 1 lần.
 * Gọi trong runAutoCheckout() và cron đêm (sau bước đánh dấu quên check-out chung).
 */
export async function reportMissedCheckouts(now = new Date()) {
  await connectDB();
  const stores = await Store.find({ autoCheckoutOn: true, active: { $ne: false } }).select("name timezone autoCheckoutTime telegramAttendanceChatId").lean();
  let sent = 0;
  for (const s of stores) {
    const tz = s.timezone || DEFAULT_TZ;
    const time = isAutoCheckoutTime(s.autoCheckoutTime) ? s.autoCheckoutTime : "23:00";
    const list = await Attendance.find({
      storeId: s._id,
      status: "MISSING_CHECKOUT",
      missedNotified: false,
      checkInAt: { $gte: new Date(now.getTime() - 3 * 86400_000) }, // không gửi lại tồn đọng cũ
    })
      .select("userId checkInAt workDate shiftLabel")
      .sort({ checkInAt: 1 })
      .lean();
    // tới giờ báo của ngày làm đó chưa (giờ chốt + 2 tiếng)
    const due = list.filter((a) => now.getTime() >= cutoffOf(a, time, tz).getTime() + AUTO_LOCK_MS);
    // nhận phần báo từng lượt (chạy song song cron + người mở app → không báo trùng)
    const claimed: typeof due = [];
    for (const a of due) {
      const r = await Attendance.updateOne({ _id: a._id, status: "MISSING_CHECKOUT", missedNotified: false }, { $set: { missedNotified: true } });
      if (r.modifiedCount) claimed.push(a);
    }
    if (!claimed.length) continue;
    const users = await User.find({ _id: { $in: claimed.map((a) => a.userId) } }).select("name email").lean();
    const nameOf = new Map(users.map((u) => [String(u._id), u.name || u.email || "?"]));
    const days = [...new Set(claimed.map((a) => a.workDate))].sort();
    for (const day of days) {
      const rows = claimed.filter((a) => a.workDate === day);
      await notifyMissed(
        s,
        day,
        time,
        rows.map((a) => `• ${nameOf.get(String(a.userId)) ?? "?"}: vào ${hm(a.checkInAt, tz)} · ca ${a.shiftLabel || "ngoài ca"}`),
      );
    }
    sent += claimed.length;
  }
  return sent;
}

/** 1 tin vào nhóm chấm công của cơ sở: danh sách quên check-out của 1 ngày. Không ném lỗi. */
async function notifyMissed(store: { name: string; telegramAttendanceChatId?: string | null }, day: string, time: string, lines: string[]) {
  try {
    if (!telegramConfigured()) return;
    const chatId = attendanceChatId(store);
    if (!chatId) return;
    const text = [
      "⏰ QUÊN CHECK-OUT",
      `🏪 Cơ sở: ${store.name.replace(/^TBS\s+/i, "")}`,
      `📅 Ngày: ${viDate(day).slice(0, 5)} (${weekdayVi(day)}) · chốt công ca tối ${time}`,
      `Có ${lines.length} nhân viên quên check-out → ghi QUÊN CHECK-OUT, chưa tính công các lượt này:`,
      ...lines,
      "👉 Nhân viên gửi yêu cầu điều chỉnh giờ ra ở Lịch sử để admin duyệt.",
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
 *  1. vừa bị ghi quên check-out lúc hết hạn (≤ 2 tiếng): khoá, nút CHECK-OUT mờ + lý do;
 *  2. vừa check-out sau giờ chốt ca tối (công tính tới 23:00): khoá tới 23:00 + 2 tiếng – không check-in lại làm qua đêm;
 *  3. giờ cấm check-in (Cài đặt, mặc định 01:00–06:00): khoá, nút CHECK-IN mờ.
 * (autoCheckout: lượt cũ do bản trước tự check-out – vẫn hiển thị đúng)
 */
export async function checkinLock(userId: unknown, tz: string, now = new Date()): Promise<CheckinLock | null> {
  await connectDB();
  const since = new Date(now.getTime() - AUTO_LOCK_MS);
  const auto = await Attendance.findOne({
    userId,
    $or: [
      { autoCheckout: true, checkOutAt: { $gt: since, $lte: now } }, // (bản cũ) đã được tự check-out
      { actualCheckOutAt: { $ne: null }, checkOutAt: { $gt: since, $lte: now } }, // check-out sau giờ chốt ca tối
      { cutoffMissingAt: { $gt: since, $lte: now } }, // quá hạn check-out → ghi quên check-out
    ],
  })
    .sort({ updatedAt: -1 })
    .select("checkOutAt actualCheckOutAt cutoffMissingAt storeId autoCheckout")
    .lean();
  const capped = !!auto?.actualCheckOutAt && !!auto.checkOutAt;
  const at = (auto?.autoCheckout || capped) && auto?.checkOutAt ? auto.checkOutAt : auto?.cutoffMissingAt;
  if (auto && at) {
    const stTz = (await Store.findById(auto.storeId).select("timezone").lean())?.timezone || tz;
    const t = hm(at, stTz);
    return {
      kind: "auto",
      button: capped ? "CHECK-IN" : "CHECK-OUT",
      message: capped
        ? `Bạn đã check-out lúc ${hm(auto.actualCheckOutAt!, stTz)} – công tính tới ${t} (giờ chốt ca tối). Hết giờ chấm công hôm nay.`
        : auto.autoCheckout
          ? `Bạn đã được hệ thống tự động check-out lúc ${t} (hết ca tối). Sai giờ thì gửi yêu cầu bổ sung ở Lịch sử.`
          : `Đã quá hạn check-out (${t}) – lượt chấm công này ghi QUÊN CHECK-OUT, không check-out được nữa. Gửi yêu cầu điều chỉnh giờ ra ở Lịch sử.`,
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
