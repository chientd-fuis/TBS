import { Types } from "mongoose";
import { connectDB } from "./db";
import { Attendance, ProbationRequest, Settings, Store, User, WageHistory } from "./models";
import { audit, type Actor } from "./audit";
import { DEFAULT_TZ, localDate, localTime, viDate, weekdayVi } from "./time";
import { computeFields, isMonthLocked, payStoreOf, storeTz } from "./attendance";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { APPROVE_PERM, responsibleAdminNames } from "./admin-stores";

/**
 * Nhân viên THỬ VIỆC.
 *  - Lương mặc định 20.000đ/giờ. Không dùng Chốt ca, Nhận hàng, Tồn kho; app nhân viên màu hồng tím.
 *  - 3 CA THỬ VIỆC: 3 lượt chấm công đầu tiên (đã check-out) tính 50% giờ công (Cài đặt: probationTrialHalf, mặc định bật),
 *    nhân viên thấy "Ca thử việc". Xong ca thứ 3 → gửi admin cơ sở: Nhận / Không nhận (ProbationRequest TRIAL).
 *      · Nhận: làm tiếp; tắt "tháng thử việc" → lên chính thức 22k/h luôn (từ ca thứ 4).
 *      · Không nhận: cho nghỉ việc (khoá tài khoản) – 3 ca vẫn trả 50%.
 *    Trong lúc chờ admin: nhân viên vẫn chấm công, ca thứ 4 trở đi tính 100%.
 *  - THÁNG THỬ VIỆC (Cài đặt: probationMonthOn, mặc định bật): hết 1 tháng → gửi admin "áp dụng lương 22k từ ngày hết thử việc?"
 *    (ProbationRequest MONTH): Đồng ý → chính thức 22k/h · Chưa → gia hạn thử việc thêm 1 tháng (hết tháng hỏi lại).
 */
export const PROBATION_WAGE = 20000;
export const OFFICIAL_WAGE = 22000;
export const TRIAL_SHIFTS = 3;
/** (cũ) số ca tối thiểu trong tháng thử việc – chỉ còn để hiển thị */
export const PROBATION_MIN_SHIFTS = 10;
export const PROBATION_OFF = "Nhân viên thử việc chưa dùng chức năng này";

type Id = string | Types.ObjectId;

export const isProbation = (u: { probation?: boolean | null } | null | undefined) => !!u?.probation;

/** Cài đặt thử việc (lean không có default → trống = bật) */
export async function probationConfig() {
  const s = await Settings.findOne({ key: "main" }).select("probationMonthOn probationTrialHalf").lean();
  return { monthOn: s?.probationMonthOn !== false, trialHalf: s?.probationTrialHalf !== false };
}

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
  if (u.trialStage === "ON" || u.trialStage === "PENDING") u.set({ trialStage: "DONE" });
  await u.save();
  if (raise) await WageHistory.create({ userId: u._id, hourlyWage: newWage, effectiveFrom: from, createdBy: by });
  return { wage: newWage, raised: raise };
}

/** Tính lại giờ công 1 lượt với hệ số mới (bỏ qua tháng đã trả lương) */
async function setFactor(a: Parameters<typeof computeFields>[0] & { _id: unknown; month: string; userId: unknown; homeStoreId?: Id | null }, trial: boolean, factor: number) {
  if (await isMonthLocked(payStoreOf(a), a.month, a.userId as Id)) return;
  const f = await computeFields({ ...a, payFactor: factor });
  await Attendance.updateOne(
    { _id: a._id },
    trial ? { $set: { trial: true, payFactor: factor, roundedHours: f.roundedHours } } : { $set: { roundedHours: f.roundedHours }, $unset: { trial: 1, payFactor: 1 } },
  );
}

/**
 * Đồng bộ 3 CA THỬ VIỆC của 1 nhân viên (gọi sau check-out, admin sửa / chấm hộ, cron): đánh dấu 3 lượt đã check-out đầu tiên
 * từ ngày bắt đầu thử việc (50% giờ công), bỏ đánh dấu lượt khác; đủ 3 ca → gửi admin Nhận / Không nhận.
 * Đã nhận / không nhận / không thử việc → không làm gì (giữ nguyên 3 ca đã chốt).
 */
export async function syncTrial(userId: Id) {
  await connectDB();
  const u = await User.findById(userId).select("name email storeId probation probationStart trialStage status").lean();
  if (!u?.probation || !u.probationStart || (u.trialStage !== "ON" && u.trialStage !== "PENDING")) return null;
  const { trialHalf } = await probationConfig();
  const factor = trialHalf ? 0.5 : 1;
  const sel = "storeId homeStoreId userId month workDate shiftAssignmentId shiftLabel checkInAt checkOutAt extraHours trial payFactor roundedHours";
  const first = await Attendance.find({ userId: u._id, status: "COMPLETED", workDate: { $gte: u.probationStart } }).sort({ checkInAt: 1 }).limit(TRIAL_SHIFTS).select(sel).lean();
  const ids = first.map((a) => String(a._id));
  for (const a of first) if (!a.trial || (a.payFactor ?? 1) !== factor) await setFactor(a, true, factor);
  // lượt từng là ca thử việc nhưng không còn trong 3 lượt đầu (VD admin thêm lượt sớm hơn) → tính đủ lại
  for (const a of await Attendance.find({ userId: u._id, trial: true, _id: { $nin: first.map((x) => x._id) } }).select(sel).lean()) await setFactor(a, false, 1);

  if (u.trialStage === "PENDING") {
    // đang chờ admin: cập nhật danh sách 3 ca trong yêu cầu
    await ProbationRequest.updateOne({ userId: u._id, kind: "TRIAL", status: "PENDING" }, { $set: { attendanceIds: first.map((a) => a._id) } });
  } else if (first.length >= TRIAL_SHIFTS) {
    const r = await User.updateOne({ _id: u._id, trialStage: "ON" }, { $set: { trialStage: "PENDING" } });
    if (r.modifiedCount && !(await ProbationRequest.exists({ userId: u._id, kind: "TRIAL", status: "PENDING" }))) {
      const req = await ProbationRequest.create({ userId: u._id, storeId: u.storeId, kind: "TRIAL", attendanceIds: first.map((a) => a._id) });
      await notifyProbation(String(req._id));
    }
  }
  return { trialIds: ids };
}

/** Cron hằng ngày: đồng bộ 3 ca thử việc (dự phòng) + hết tháng thử việc → gửi admin "áp dụng lương 22k?" */
export async function runProbation(now = new Date()) {
  await connectDB();
  const today = localDate(now, DEFAULT_TZ);
  const { monthOn } = await probationConfig();
  const list = await User.find({ probation: true, probationStart: { $type: "string" }, status: "ACTIVE" }).select("_id storeId probationStart trialStage").lean();
  let trial = 0;
  let month = 0;
  for (const u of list) {
    if (u.trialStage === "ON" || u.trialStage === "PENDING") {
      await syncTrial(u._id);
      trial++;
      continue; // chưa qua 3 ca thử việc → chưa xét tháng
    }
    if (!monthOn) continue;
    const end = probationEnd(u.probationStart!);
    if (today < end) continue;
    if (await ProbationRequest.exists({ userId: u._id, kind: "MONTH", periodStart: u.probationStart })) continue; // đã hỏi kỳ này
    const shifts = await probationShifts(u._id, u.probationStart!, end);
    const req = await ProbationRequest.create({ userId: u._id, storeId: u.storeId, kind: "MONTH", periodStart: u.probationStart, periodEnd: end, shifts });
    await audit({ kind: "SYSTEM", name: "Tự động (thử việc)" } as Actor, "user.probation.monthRequest", { type: "User", id: String(u._id) }, null, { shifts, end });
    await notifyProbation(String(req._id));
    month++;
  }
  return { trial, month };
}

/** Nội dung 3 ca thử việc: "T2 10/11 · Sáng 08:00–12:00 · 4h → tính 2h" */
export async function trialShiftLines(ids: unknown[], tz?: string) {
  const atts = await Attendance.find({ _id: { $in: ids } }).select("storeId workDate shiftLabel checkInAt checkOutAt totalHours roundedHours payFactor").sort({ checkInAt: 1 }).lean();
  const out: string[] = [];
  for (const a of atts) {
    const z = tz ?? (await storeTz(a.storeId));
    const hm = (d?: Date | null) => (d ? localTime(d, z).slice(0, 5) : "--");
    const full = a.payFactor && a.payFactor < 1 ? ` (${String(a.totalHours ?? 0).replace(".", ",")}h thực tế)` : "";
    out.push(`${weekdayVi(a.workDate)} ${viDate(a.workDate).slice(0, 5)} · ${a.shiftLabel ?? "Ngoài ca"} · ${hm(a.checkInAt)}–${hm(a.checkOutAt)} · tính ${String(a.roundedHours ?? 0).replace(".", ",")}h${full}`);
  }
  return out;
}

/** Báo nhóm chấm công của cơ sở: yêu cầu thử việc cần admin xác nhận. Không ném lỗi. */
export async function notifyProbation(requestId: string) {
  try {
    if (!telegramConfigured()) return;
    const r = await ProbationRequest.findById(requestId).lean();
    if (!r) return;
    const [u, store] = await Promise.all([User.findById(r.userId).select("name email").lean(), Store.findById(r.storeId).select("name telegramAttendanceChatId").lean()]);
    if (!store) return;
    const chatId = attendanceChatId(store);
    if (!chatId) return;
    const admins = await responsibleAdminNames(r.storeId, APPROVE_PERM.probation);
    const head = [`🏪 Cơ sở: ${store.name.replace(/^TBS\s+/i, "")}`, `👤 Nhân viên: ${u?.name || u?.email || "?"}`];
    const text =
      r.kind === "TRIAL"
        ? [
            "🟣 HẾT 3 CA THỬ VIỆC – CẦN ADMIN XÁC NHẬN",
            ...head,
            "📋 3 ca thử việc:",
            ...(await trialShiftLines(r.attendanceIds ?? [])).map((l) => `• ${l}`),
            "❓ Có nhận nhân viên làm tiếp không? NHẬN / KHÔNG NHẬN (cho nghỉ việc, 3 ca vẫn trả theo giờ đã tính).",
            `👉 Cần admin ${admins.join(", ")} xác nhận: vào Yêu cầu → Thử việc.`,
          ]
        : [
            "🟣 HẾT THÁNG THỬ VIỆC – ÁP DỤNG LƯƠNG CHÍNH THỨC?",
            ...head,
            `📅 Thử việc ${viDate(r.periodStart!).slice(0, 5)} → ${viDate(r.periodEnd!).slice(0, 5)} · đã làm ${r.shifts ?? 0} ca`,
            `❓ Áp dụng lương ${OFFICIAL_WAGE.toLocaleString("vi-VN")}đ/giờ từ ${viDate(r.periodEnd!).slice(0, 5)}? ĐỒNG Ý / CHƯA (gia hạn thử việc 1 tháng).`,
            `👉 Cần admin ${admins.join(", ")} xác nhận: vào Yêu cầu → Thử việc.`,
          ];
    await sendTelegramText(chatId, text.join("\n"));
  } catch (e) {
    console.error("[probation notify]", (e as Error).message);
  }
}
