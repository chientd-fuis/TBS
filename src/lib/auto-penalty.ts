import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, Attendance, AutoPenaltyWaiver, BonusPenalty, ShiftAssignment, Store, User } from "./models";
import { getSettings } from "./settings";
import { minutesVi } from "./format";
import { isMonthLocked, shiftWindow } from "./attendance";
import { addDays, DEFAULT_TZ, localDate, zonedToDate } from "./time";

/**
 * Phạt tự động (Cài đặt → Cấu hình chấm công): đi muộn, bỏ ca, quên check-out, quên check-in.
 * Chạy hằng giờ (cron) + ngay khi lưu cài đặt. Cách làm "đối soát": tính danh sách khoản phạt ĐÚNG theo dữ liệu
 * hiện tại (từ ngày áp dụng, tối đa 40 ngày gần nhất) rồi tạo / sửa / xoá các khoản tự động cho khớp:
 *  - admin sửa giờ (hết muộn), duyệt bổ sung chấm công (hết bỏ ca)… → khoản phạt tương ứng tự cập nhật / xoá
 *  - admin XOÁ khoản tự động = miễn phạt → không tạo lại (AutoPenaltyWaiver); admin SỬA tay → không tự đụng nữa
 *  - tháng đã trả lương → không đụng
 * Mỗi khoản gắn với cơ sở gốc của nhân viên (giống thưởng / phạt nhập tay).
 */

const MIN_IN_SHIFT_MS = 30 * 60_000;
/** ca kết thúc quá chừng này mà không có chấm công → bỏ ca (chờ nhân viên gửi yêu cầu bổ sung nếu quên) */
const NO_SHOW_GRACE_MS = 2 * 3600_000;
const LOOKBACK_DAYS = 40;

type Want = { userId: Types.ObjectId; date: string; amountVnd: number; content: string; attendanceId?: Types.ObjectId };

const k = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString("vi-VN"));

export async function runAutoPenalties(now = new Date()) {
  await connectDB();
  const s = await getSettings();
  if (!s.autoPenaltyOn) return { skipped: true };
  const late = Math.max(0, s.penaltyLateVnd ?? 0);
  const perMin = Math.max(0, s.penaltyLatePerMinVnd ?? 0);
  const noShow = Math.max(0, s.penaltyNoShowVnd ?? 0);
  const missOut = Math.max(0, s.penaltyMissingOutVnd ?? 0);
  const missIn = Math.max(0, s.penaltyMissingInVnd ?? 0);

  const today = localDate(now, DEFAULT_TZ);
  const floor = addDays(today, -LOOKBACK_DAYS);
  const from = s.autoPenaltyFrom && s.autoPenaltyFrom > floor ? s.autoPenaltyFrom : floor;
  const fromAt = zonedToDate(from, "00:00", DEFAULT_TZ);

  const want = new Map<string, Want>();

  // 1) đi muộn / quên check-out / quên check-in – theo từng lượt chấm công
  const atts = await Attendance.find({ workDate: { $gte: from } })
    .select("userId storeId workDate checkInAt checkOutAt status missedCheckout lateMinutes source shiftAssignmentId shiftLabel createdAt")
    .lean();
  for (const a of atts) {
    const lm = a.lateMinutes ?? 0;
    if (lm > 0 && (late || perMin)) {
      want.set(`late:${a._id}`, {
        userId: a.userId,
        date: a.workDate,
        amountVnd: late + perMin * lm,
        content: `Đi muộn ${minutesVi(lm)}${a.shiftLabel ? ` (${a.shiftLabel})` : ""} – phạt tự động`,
        attendanceId: a._id,
      });
    }
    if (missOut && (a.status === "MISSING_CHECKOUT" || a.missedCheckout)) {
      want.set(`out:${a._id}`, { userId: a.userId, date: a.workDate, amountVnd: missOut, content: "Quên check-out – phạt tự động", attendanceId: a._id });
    }
    // quên check-in: lượt do admin chấm hộ / duyệt yêu cầu bổ sung (không tự chấm), tạo sau ngày áp dụng (bỏ qua dữ liệu import cũ)
    if (missIn && a.source !== "SELF" && a.createdAt && a.createdAt >= fromAt) {
      want.set(`in:${a._id}`, { userId: a.userId, date: a.workDate, amountVnd: missIn, content: "Quên chấm công (admin chấm hộ / bổ sung) – phạt tự động", attendanceId: a._id });
    }
  }

  // 2) bỏ ca: ca đã duyệt, đã kết thúc quá 2 giờ, không có lượt chấm công nào trùng ca (≥ 30 phút / gắn đúng ca)
  if (noShow) {
    const tzOf = new Map((await Store.find().select("timezone").lean()).map((x) => [String(x._id), x.timezone || DEFAULT_TZ]));
    const shifts = await ShiftAssignment.find({ date: { $gte: from, $lte: today }, ...APPROVED_SHIFT }).select("userId storeId date startTime endTime shiftName").lean();
    const byUser = new Map<string, typeof atts>();
    for (const a of atts) (byUser.get(String(a.userId)) ?? byUser.set(String(a.userId), []).get(String(a.userId))!).push(a);
    // lượt check-in ngày hôm trước (ca qua đêm) chưa nằm trong atts → lấy thêm
    const early = await Attendance.find({ workDate: addDays(from, -1) }).select("userId checkInAt checkOutAt shiftAssignmentId").lean();
    for (const a of early) (byUser.get(String(a.userId)) ?? byUser.set(String(a.userId), []).get(String(a.userId))!).push(a as (typeof atts)[number]);
    const active = new Set((await User.find({ _id: { $in: shifts.map((x) => x.userId) }, status: "ACTIVE" }).distinct("_id")).map(String));
    for (const sh of shifts) {
      if (!sh.startTime || !sh.endTime || !active.has(String(sh.userId))) continue;
      const w = shiftWindow(sh.date, sh.startTime, sh.endTime, tzOf.get(String(sh.storeId)) ?? DEFAULT_TZ);
      if (w.end.getTime() + NO_SHOW_GRACE_MS > now.getTime()) continue;
      const worked = (byUser.get(String(sh.userId)) ?? []).some((a) => {
        if (a.shiftAssignmentId && String(a.shiftAssignmentId) === String(sh._id)) return true;
        const inT = a.checkInAt.getTime();
        const outT = (a.checkOutAt ?? new Date(inT + 12 * 3600_000)).getTime(); // quên check-out → coi như có làm
        return Math.min(outT, w.end.getTime()) - Math.max(inT, w.start.getTime()) >= MIN_IN_SHIFT_MS;
      });
      if (worked) continue;
      want.set(`noshow:${sh._id}`, {
        userId: sh.userId,
        date: sh.date,
        amountVnd: noShow,
        content: `Bỏ ca ${sh.shiftName ?? ""} ${sh.startTime}–${sh.endTime} (có lịch, không chấm công) – phạt tự động`.replace(/\s+/g, " "),
      });
    }
  }

  // 3) đối soát với các khoản tự động đang có
  const existing = await BonusPenalty.find({ autoKey: { $type: "string" }, date: { $gte: from } }).lean();
  const have = new Map(existing.map((b) => [b.autoKey!, b]));
  const waived = new Set(
    (await AutoPenaltyWaiver.find({ key: { $in: [...want.keys(), ...have.keys()] } }).select("key").lean()).map((w) => w.key),
  );
  const homeOf = new Map(
    (await User.find({ _id: { $in: [...new Set([...want.values()].map((w) => String(w.userId)))] } }).select("storeId").lean()).map((u) => [String(u._id), u.storeId]),
  );
  const lockCache = new Map<string, boolean>();
  const locked = async (storeId: unknown, month: string, userId: unknown) => {
    const key = `${storeId}|${month}|${userId}`;
    if (!lockCache.has(key)) lockCache.set(key, await isMonthLocked(storeId as Types.ObjectId, month, userId as Types.ObjectId));
    return lockCache.get(key)!;
  };

  let created = 0;
  let updated = 0;
  let removed = 0;
  for (const [key, w] of want) {
    if (waived.has(key)) continue;
    const month = w.date.slice(0, 7);
    const cur = have.get(key);
    if (cur) {
      if (cur.autoEdited || (cur.amountVnd === w.amountVnd && cur.content === w.content && cur.date === w.date)) continue;
      if (await locked(cur.storeId, cur.month, cur.userId)) continue;
      await BonusPenalty.updateOne({ _id: cur._id }, { $set: { amountVnd: w.amountVnd, content: w.content, date: w.date, month } });
      updated++;
      continue;
    }
    const storeId = homeOf.get(String(w.userId));
    if (!storeId || (await locked(storeId, month, w.userId))) continue;
    try {
      await BonusPenalty.create({ userId: w.userId, storeId, kind: "PENALTY", date: w.date, month, amountVnd: w.amountVnd, content: w.content, attendanceId: w.attendanceId, createdBy: "Tự động", autoKey: key });
      created++;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // trùng autoKey (2 lần chạy cùng lúc) → bỏ qua
    }
  }
  // sự kiện không còn (admin sửa giờ / bổ sung chấm công / tắt loại phạt) → xoá khoản tự động chưa bị sửa tay
  for (const [key, b] of have) {
    if (want.has(key) || b.autoEdited) continue;
    if (await locked(b.storeId, b.month, b.userId)) continue;
    await BonusPenalty.deleteOne({ _id: b._id });
    removed++;
  }
  return { created, updated, removed, from };
}

/** Mô tả ngắn mức phạt đang bật (hiện ở Cài đặt). */
export function autoPenaltySummary(s: { penaltyLateVnd?: number | null; penaltyLatePerMinVnd?: number | null; penaltyNoShowVnd?: number | null; penaltyMissingOutVnd?: number | null; penaltyMissingInVnd?: number | null }) {
  const parts: string[] = [];
  if (s.penaltyLateVnd || s.penaltyLatePerMinVnd)
    parts.push(`muộn ${[s.penaltyLateVnd ? k(s.penaltyLateVnd) : "", s.penaltyLatePerMinVnd ? `${k(s.penaltyLatePerMinVnd)}/phút` : ""].filter(Boolean).join(" + ")}`);
  if (s.penaltyNoShowVnd) parts.push(`bỏ ca ${k(s.penaltyNoShowVnd)}`);
  if (s.penaltyMissingOutVnd) parts.push(`quên check-out ${k(s.penaltyMissingOutVnd)}`);
  if (s.penaltyMissingInVnd) parts.push(`quên check-in ${k(s.penaltyMissingInVnd)}`);
  return parts.join(" · ");
}
