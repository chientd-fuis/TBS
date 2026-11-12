import { Types } from "mongoose";
import { connectDB } from "./db";
import { Attendance, User, WageHistory } from "./models";
import { audit, type Actor } from "./audit";
import { DEFAULT_TZ, localDate } from "./time";

/**
 * Nhân viên THỬ VIỆC.
 *  - Lương mặc định 20.000đ/giờ.
 *  - Không dùng Chốt ca, Nhận hàng, Tồn kho; app nhân viên đổi màu hồng tím.
 *  - Hết 1 tháng kể từ ngày bắt đầu: làm được ≥ 10 ca → tự chuyển CHÍNH THỨC, lương 22.000đ/giờ từ ngày đó;
 *    chưa đủ 10 ca → vẫn thử việc, gắn "Cần xem xét" để admin quyết (chuyển chính thức / gia hạn).
 */
export const PROBATION_WAGE = 20000;
export const OFFICIAL_WAGE = 22000;
export const PROBATION_MIN_SHIFTS = 10;
export const PROBATION_OFF = "Nhân viên thử việc chưa dùng chức năng này";

type Id = string | Types.ObjectId;

export const isProbation = (u: { probation?: boolean | null } | null | undefined) => !!u?.probation;

/** Ngày kết thúc thử việc = cùng ngày tháng sau (31/01 → 28/02 hoặc 29/02) */
export function probationEnd(start: string) {
  const [y, m, d] = start.split("-").map(Number);
  const lastOfNext = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, lastOfNext))).toISOString().slice(0, 10);
}

/** Số ca (lượt chấm công) đã làm trong tháng thử việc [start, end) */
export async function probationShifts(userId: Id, start: string, end = probationEnd(start)) {
  return Attendance.countDocuments({ userId, workDate: { $gte: start, $lt: end } });
}

/** Chuyển chính thức: bỏ thử việc, lương giờ ≥ 22.000đ áp dụng từ `from` (giữ lương cao hơn nếu admin đã đặt). */
export async function makeOfficial(userId: Id, from: string, by: string, wage?: number) {
  const u = await User.findById(userId);
  if (!u) throw new Error("Không tìm thấy nhân viên");
  const newWage = Math.round(wage && wage > 0 ? wage : Math.max(OFFICIAL_WAGE, u.hourlyWage || 0));
  const raise = newWage !== u.hourlyWage;
  u.set({ probation: false, probationReview: false, probationEndedAt: new Date(), hourlyWage: newWage });
  await u.save();
  if (raise) await WageHistory.create({ userId: u._id, hourlyWage: newWage, effectiveFrom: from, createdBy: by });
  return { wage: newWage, raised: raise };
}

/** Cron: nhân viên hết tháng thử việc → tự chuyển chính thức (đủ 10 ca) hoặc gắn "Cần xem xét". */
export async function runProbation(now = new Date()) {
  await connectDB();
  const today = localDate(now, DEFAULT_TZ);
  const list = await User.find({ probation: true, probationReview: { $ne: true }, probationStart: { $type: "string" }, status: "ACTIVE" })
    .select("_id name probationStart hourlyWage")
    .lean();
  let official = 0;
  let review = 0;
  const actor: Actor = { kind: "SYSTEM", name: "Tự động (thử việc)" };
  for (const u of list) {
    const end = probationEnd(u.probationStart!);
    if (today < end) continue;
    const n = await probationShifts(u._id, u.probationStart!, end);
    if (n >= PROBATION_MIN_SHIFTS) {
      const r = await makeOfficial(u._id, end, actor.name);
      await audit(actor, "user.probation.official", { type: "User", id: String(u._id) }, null, { shifts: n, wage: r.wage, from: end, auto: true });
      official++;
    } else {
      await User.updateOne({ _id: u._id }, { $set: { probationReview: true } });
      await audit(actor, "user.probation.review", { type: "User", id: String(u._id) }, null, { shifts: n, need: PROBATION_MIN_SHIFTS });
      review++;
    }
  }
  return { official, review };
}
