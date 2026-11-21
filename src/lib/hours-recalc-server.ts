import { Types } from "mongoose";
import { connectDB } from "./db";
import { Attendance, HoursRecalc, User } from "./models";
import { getSettings } from "./settings";
import { isMonthLocked, payStoreOf } from "./attendance";
import { loadHolidays } from "./holiday";
import { localDate, localMonth, prevMonth } from "./time";
import { autoApplied, baseHours, planRecalc, recalcModeOf, type RecalcPlan, type RecalcRow } from "./hours-recalc";
import type { RoundingConfig } from "./calc";

/*
 * TÍNH LẠI GIỜ CÔNG – phần đọc / ghi DB (công thức: lib/hours-recalc.ts).
 * Phần cộng ghi thẳng vào roundedHours của lượt chấm công (+ autoPlus / autoBase) → bảng lương, xuất Excel, lịch sử nhân viên tự nhận.
 * Trạng thái theo nhân viên × tháng (đã tính lúc nào, admin đã Huỷ chưa) ở HoursRecalc.
 */

type Id = string | Types.ObjectId;
const AUTO_BY = "Tự động";
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function recalcConfig() {
  const s = await getSettings();
  const cfg: RoundingConfig = { stepHours: s.roundStepHours, graceMinutes: s.roundGraceMinutes, graceHourMinutes: s.roundGraceHourMinutes ?? s.roundGraceMinutes };
  return {
    mode: recalcModeOf(s.hoursRecalcMode),
    threshold: s.hoursRecalcThreshold ?? 1,
    maxShortMin: s.hoursRecalcMaxShort ?? 23,
    cfg,
  };
}
export type RecalcConfig = Awaited<ReturnType<typeof recalcConfig>>;

type AttLite = {
  _id: unknown;
  workDate: string;
  checkInAt: Date;
  checkOutAt?: Date | null;
  status?: string | null;
  totalHours?: number | null;
  roundedHours?: number | null;
  autoPlus?: number | null;
  autoBase?: number | null;
  payFactor?: number | null;
  extraHours?: number | null;
};

/** Lượt chấm công (đã check-out) → dòng tính lại. */
export function toRecalcRows(atts: AttLite[]): RecalcRow[] {
  return atts
    .filter((a) => a.status === "COMPLETED" && a.checkOutAt)
    .map((a) => ({
      id: String(a._id),
      workDate: a.workDate,
      checkInAt: a.checkInAt,
      checkOutAt: a.checkOutAt!,
      totalHours: a.totalHours || 0,
      base: baseHours(a),
      payFactor: a.payFactor,
      extraHours: a.extraHours,
    }));
}

export async function monthHolidays(month: string) {
  return new Set((await loadHolidays(`${month}-01`, `${month}-31`)).keys());
}

/** Kế hoạch tính lại từ danh sách lượt đã có sẵn (trang Bảng chấm công – không đọc DB thêm). */
export function planFromAtts(atts: AttLite[], conf: RecalcConfig, holidays?: Set<string>): RecalcPlan {
  return planRecalc(toRecalcRows(atts), conf.cfg, { threshold: conf.threshold, maxShortMin: conf.maxShortMin, holidays });
}

/** Số liệu 1 nhân viên × tháng cho Bảng chấm công: giờ thực tế, giờ chấm công (gốc), giờ công (đã cộng), kế hoạch tính lại. */
export function hourStats(atts: AttLite[], conf: RecalcConfig, holidays?: Set<string>) {
  const plan = planFromAtts(atts, conf, holidays);
  const done = atts.filter((a) => a.status === "COMPLETED" && a.checkOutAt);
  const final = r2(done.reduce((s, a) => s + (a.roundedHours || 0), 0));
  const applied = done.filter((a) => autoApplied(a));
  const appliedIds = applied.map((a) => String(a._id)).sort();
  const planIds = plan.picks.map((p) => p.id).sort();
  return {
    plan,
    actual: plan.actual,
    base: plan.before,
    final,
    auto: r2(final - plan.before),
    autoCount: applied.length,
    appliedIds,
    /** phần đang cộng = đúng kế hoạch hiện tại (không cần tính lại) */
    matches: appliedIds.length === planIds.length && appliedIds.every((id, i) => id === planIds[i]),
  };
}
export type HourStats = ReturnType<typeof hourStats>;

const SEL = "storeId homeStoreId userId month workDate checkInAt checkOutAt status totalHours roundedHours autoPlus autoBase payFactor extraHours";

async function monthAtts(userId: Id, month: string) {
  return Attendance.find({ userId, month, status: "COMPLETED", checkOutAt: { $ne: null } }).select(SEL).lean();
}

async function lockedFor(userId: Id, month: string, atts: { storeId: Types.ObjectId; homeStoreId?: Types.ObjectId | null }[]) {
  const stores = new Set(atts.map((a) => String(payStoreOf(a))));
  if (!stores.size) {
    const u = await User.findById(userId).select("storeId").lean();
    if (u?.storeId) stores.add(String(u.storeId));
  }
  for (const s of stores) if (await isMonthLocked(s, month, userId)) return true;
  return false;
}

/** Ghi giờ công: lượt được chọn = gốc + phần cộng; lượt khác = gốc (bỏ phần cộng cũ). Chỉ ghi lượt thay đổi. */
async function writeHours(atts: AttLite[], adds: Map<string, number>) {
  const ops = [];
  for (const a of atts) {
    const base = baseHours(a);
    const add = adds.get(String(a._id)) ?? 0;
    const want = r2(base + add);
    const curPlus = a.autoPlus || 0;
    if (Math.abs((a.roundedHours || 0) - want) < 0.005 && Math.abs(curPlus - add) < 0.005 && (add === 0 || a.autoBase === base)) continue;
    ops.push({
      updateOne: {
        filter: { _id: a._id },
        update: add > 0 ? { $set: { roundedHours: want, autoPlus: add, autoBase: base } } : { $set: { roundedHours: want, autoPlus: 0 }, $unset: { autoBase: 1 } },
      },
    });
  }
  if (ops.length) await Attendance.bulkWrite(ops);
  return ops.length;
}

export type RecalcResult = { status: "applied" | "locked" | "cancelled"; plan?: RecalcPlan; changed?: number };

/**
 * Tính lại 1 nhân viên × 1 tháng và ghi. manual = admin bấm (bỏ cờ Huỷ); tự động thì bỏ qua người admin đã Huỷ.
 * Tháng đã trả lương → không đụng.
 */
export async function applyUserMonth(userId: Id, month: string, opts: { by?: string; manual?: boolean; conf?: RecalcConfig } = {}): Promise<RecalcResult> {
  await connectDB();
  const atts = await monthAtts(userId, month);
  if (await lockedFor(userId, month, atts)) return { status: "locked" };
  if (!opts.manual) {
    const st = await HoursRecalc.findOne({ userId, month }).select("cancelled").lean();
    if (st?.cancelled) return { status: "cancelled" };
  }
  const conf = opts.conf ?? (await recalcConfig());
  const plan = planFromAtts(atts, conf, await monthHolidays(month));
  const changed = await writeHours(atts, new Map(plan.picks.map((p) => [p.id, p.add])));
  // chưa từng tính và không cần tính → không tạo bản ghi trạng thái (đỡ rác)
  const had = await HoursRecalc.exists({ userId, month });
  if (had || plan.picks.length || opts.manual) {
    await HoursRecalc.updateOne(
      { userId, month },
      {
        $set: {
          at: new Date(),
          by: opts.by ?? AUTO_BY,
          actual: plan.actual,
          before: plan.before,
          after: plan.after,
          picks: plan.picks.length,
          enough: plan.enough,
          ...(opts.manual ? { cancelled: false } : {}),
        },
      },
      { upsert: true },
    );
  }
  return { status: "applied", plan, changed };
}

/** Huỷ tính lại: giờ công về số chấm công gốc, tự động bỏ qua người này trong tháng (tới khi admin bấm Tính lại). */
export async function cancelUserMonth(userId: Id, month: string, by: string): Promise<RecalcResult> {
  await connectDB();
  const atts = await monthAtts(userId, month);
  if (await lockedFor(userId, month, atts)) return { status: "locked" };
  const changed = await writeHours(atts, new Map());
  const before = r2(atts.reduce((s, a) => s + baseHours(a), 0));
  await HoursRecalc.updateOne({ userId, month }, { $set: { cancelled: true, at: new Date(), by, before, after: before, picks: 0 } }, { upsert: true });
  return { status: "cancelled", changed };
}

/**
 * Tự động khi nhân viên check-out / admin sửa chấm công (cài đặt "Ngay khi check-out"). Không bao giờ ném lỗi
 * (không được làm hỏng thao tác chính) – lỗi ghi Log lỗi hệ thống.
 */
export async function autoRecalc(userId: Id | null | undefined, month: string | null | undefined) {
  if (!userId || !month) return;
  try {
    const conf = await recalcConfig();
    if (conf.mode !== "checkout") return;
    await applyUserMonth(userId, month, { conf });
  } catch (e) {
    const { logError } = await import("./error-log");
    logError({ level: "error", source: "system", area: "Tính lại giờ công (tự động)", fn: "autoRecalc", message: (e as Error).message, detail: (e as Error).stack });
  }
}

/** Nhiều lượt vừa bị đổi / xoá: tính lại mỗi nhân viên × tháng 1 lần. */
export async function autoRecalcMany(list: { userId: unknown; month?: string | null }[]) {
  const seen = new Set<string>();
  for (const a of list) {
    if (!a.month) continue;
    const k = `${a.userId}|${a.month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await autoRecalc(String(a.userId), a.month);
  }
}

/** Mọi nhân viên có chấm công trong tháng → tính lại (bỏ người đã Huỷ, tháng đã trả lương). */
async function recalcMonthAll(month: string, conf: RecalcConfig) {
  const users = await Attendance.distinct("userId", { month, status: "COMPLETED" });
  let n = 0;
  for (const u of users) {
    const r = await applyUserMonth(u as Types.ObjectId, month, { conf });
    if (r.changed) n++;
  }
  return n;
}

const TZ = "Asia/Ho_Chi_Minh";
const lastDayOf = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/**
 * Cron 23:59 giờ VN mỗi ngày (vercel.json → /api/cron/hours-recalc): chế độ "23:59 ngày cuối tháng" + hôm nay là ngày cuối tháng
 * → tính lại cả tháng cho mọi nhân viên. Không gửi thông báo.
 */
export async function runMonthEndRecalc(now = new Date()) {
  await connectDB();
  const conf = await recalcConfig();
  if (conf.mode !== "monthEnd") return { mode: conf.mode, skipped: true };
  const today = localDate(now, TZ);
  const month = today.slice(0, 7);
  if (Number(today.slice(8)) !== lastDayOf(month)) return { mode: conf.mode, skipped: true, today };
  return { mode: conf.mode, month, users: await recalcMonthAll(month, conf) };
}

/**
 * Cron đêm (01:00 giờ VN – /api/cron/hourly):
 *  - monthEnd: ngày 1–4 → tính lại tháng trước (lượt check-out sau 23:59, admin sửa công / duyệt yêu cầu những ngày đầu tháng) trước khi
 *    bảng lương tự công bố ngày 5. Người admin đã Huỷ / tháng đã trả lương → bỏ qua.
 *  - checkout: lưới an toàn – nhân viên có lượt chấm công thay đổi trong 26 giờ qua (tháng này + tháng trước) mà chưa được tính lại → tính lại.
 */
export async function runScheduledRecalc(now = new Date()) {
  await connectDB();
  const conf = await recalcConfig();
  const month = localMonth(now, TZ);
  if (conf.mode === "monthEnd") {
    const day = Number(localDate(now, TZ).slice(8));
    return day <= 4 ? { mode: conf.mode, month: prevMonth(month), users: await recalcMonthAll(prevMonth(month), conf) } : { mode: conf.mode, skipped: true };
  }
  if (conf.mode !== "checkout") return { mode: conf.mode, skipped: true };
  const since = new Date(now.getTime() - 26 * 3600_000);
  const changed = await Attendance.aggregate<{ _id: { userId: Types.ObjectId; month: string }; last: Date }>([
    { $match: { month: { $in: [month, prevMonth(month)] }, updatedAt: { $gte: since } } },
    { $group: { _id: { userId: "$userId", month: "$month" }, last: { $max: "$updatedAt" } } },
  ]);
  let n = 0;
  for (const c of changed) {
    const st = await HoursRecalc.findOne({ userId: c._id.userId, month: c._id.month }).select("at").lean();
    if (st?.at && st.at >= c.last) continue;
    const r = await applyUserMonth(c._id.userId, c._id.month, { conf });
    if (r.changed) n++;
  }
  return { mode: conf.mode, checked: changed.length, users: n };
}
