import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, ShiftAssignment, ShiftReminder, ShiftReminderSeen, Store, User } from "./models";
import { fold } from "./revenue-gap";
import { addDays, DEFAULT_TZ, localDate, localTime, zonedToDate } from "./time";

/*
 * BẢNG TIN BƠ SẦU – nhắc việc theo ngày + ca.
 *  - Admin tạo nhắc nhở: ngày, ca (Sáng / Chiều / Tối), cơ sở (trống = tất cả), nội dung, mức độ.
 *  - Nhân viên có ca được xếp khớp (cùng ngày, cùng ca, cùng cơ sở) → từ 30 phút trước giờ vào ca:
 *      · popup ở MỌI trang (tải trang là hiện) cho tới khi bấm "Đã hiểu" (xem 1 lần),
 *      · nằm ở Bảng tin trang Chấm công tới hết ca rồi tự ẩn.
 */

export const REMINDER_SHIFTS = ["Sáng", "Chiều", "Tối"] as const;
export type ReminderShift = (typeof REMINDER_SHIFTS)[number];
export const LEAD_MS = 30 * 60_000; // hiện trước giờ vào ca 30 phút

/** Ca được xếp → Sáng / Chiều / Tối: theo tên ca ("Ca sáng", "S"…), không rõ thì theo giờ vào */
export function bucketOf(name: string | null | undefined, start: string | null | undefined): ReminderShift {
  const n = fold(name ?? "").trim();
  if (/\bsang\b/.test(n) || n === "s") return "Sáng";
  if (/\bchieu\b/.test(n) || n === "c") return "Chiều";
  if (/\b(toi|dem)\b/.test(n) || n === "t") return "Tối";
  const h = Number((start ?? "").slice(0, 2));
  return h < 12 ? "Sáng" : h < 17 ? "Chiều" : "Tối";
}

/** giờ vào / ra (ms) của 1 ca được xếp – ca qua đêm: giờ ra < giờ vào → +1 ngày */
function spanOf(a: { date: string; startTime?: string | null; endTime?: string | null }, tz: string) {
  const s = zonedToDate(a.date, a.startTime || "00:00", tz).getTime();
  let e = zonedToDate(a.date, a.endTime || "23:59", tz).getTime();
  if (e <= s) e += 24 * 3600_000;
  return [s, e] as const;
}

export type ReminderItem = {
  id: string;
  date: string;
  shift: ReminderShift;
  text: string;
  level: "NORMAL" | "IMPORTANT";
  by: string;
  at: string; // giờ gửi "07:30"
  /** giờ vào / ra ca của nhân viên "08:00" / "13:00" */
  start: string;
  end: string;
  seen: boolean;
};

/** Nhắc việc đang hiệu lực của 1 nhân viên (từ 30′ trước giờ vào ca tới hết ca). */
export async function activeRemindersFor(userId: unknown, now = new Date()): Promise<ReminderItem[]> {
  await connectDB();
  const tz = DEFAULT_TZ;
  const today = localDate(now, tz);
  const days = [addDays(today, -1), today]; // ca qua đêm của hôm qua vẫn đang chạy
  const asg = await ShiftAssignment.find({ userId, date: { $in: days }, ...APPROVED_SHIFT }).select("storeId date startTime endTime shiftName").lean();
  if (!asg.length) return [];
  const t = now.getTime();
  const live = asg
    .map((a) => {
      const [s, e] = spanOf(a, tz);
      return { a, s, e, bucket: bucketOf(a.shiftName, a.startTime) };
    })
    .filter((x) => t >= x.s - LEAD_MS && t < x.e);
  if (!live.length) return [];
  const rems = await ShiftReminder.find({ date: { $in: [...new Set(live.map((x) => x.a.date))] } }).lean();
  const out: ReminderItem[] = [];
  for (const r of rems) {
    const m = live.find(
      (x) => x.a.date === r.date && x.bucket === r.shift && (!(r.storeIds ?? []).length || (r.storeIds ?? []).some((s: unknown) => String(s) === String(x.a.storeId))),
    );
    if (!m) continue;
    out.push({
      id: String(r._id),
      date: r.date,
      shift: r.shift as ReminderShift,
      text: r.text,
      level: r.level === "IMPORTANT" ? "IMPORTANT" : "NORMAL",
      by: r.createdBy ?? "Admin",
      at: localTime(new Date(r.createdAt ?? now), tz).slice(0, 5),
      start: m.a.startTime ?? "",
      end: m.a.endTime ?? "",
      seen: false,
    });
  }
  if (!out.length) return [];
  const seen = new Set(
    (await ShiftReminderSeen.find({ userId, reminderId: { $in: out.map((o) => new Types.ObjectId(o.id)) } }).select("reminderId").lean()).map((s) => String(s.reminderId)),
  );
  return out.map((o) => ({ ...o, seen: seen.has(o.id) })).sort((a, b) => (a.level === b.level ? 0 : a.level === "IMPORTANT" ? -1 : 1));
}

export async function markRemindersSeen(userId: unknown, ids: string[]) {
  await connectDB();
  for (const id of ids.slice(0, 20)) {
    if (!Types.ObjectId.isValid(id)) continue;
    await ShiftReminderSeen.updateOne({ reminderId: id, userId }, { $setOnInsert: { reminderId: id, userId } }, { upsert: true });
  }
}

/** Admin: ai sẽ nhận (nhân viên có ca khớp) + ai đã xem – cho danh sách / ô soạn */
export async function reminderTargets(r: { date: string; shift: string; storeIds?: unknown[] }) {
  await connectDB();
  const q: Record<string, unknown> = { date: r.date, ...APPROVED_SHIFT };
  if (r.storeIds?.length) q.storeId = { $in: r.storeIds };
  const asg = (await ShiftAssignment.find(q).select("userId storeId shiftName startTime").lean()).filter((a) => bucketOf(a.shiftName, a.startTime) === r.shift);
  const ids = [...new Set(asg.map((a) => String(a.userId)))];
  const users = ids.length ? await User.find({ _id: { $in: ids } }).select("name").lean() : [];
  return users.map((u) => ({ id: String(u._id), name: u.name || "?" }));
}

export async function storeNames() {
  await connectDB();
  return new Map((await Store.find().select("name").lean()).map((s) => [String(s._id), s.name.replace(/^TBS\s+/i, "")]));
}
