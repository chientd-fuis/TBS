import { Types } from "mongoose";
import { connectDB } from "./db";
import { Attendance, BonusPenalty, Expense, FixedCost, PayrollItem, SalaryHistory, ShiftClosing, Store, User, WageHistory } from "./models";
import { payTermsAt } from "./salary";
import { dayRevenueFromClosings, type DayRevenueRow } from "./revenue";
import { computePnl, daysInMonth, type PnlInput, type PnlResult } from "./finance";
import { addDays } from "./time";
import { loadHolidays } from "./holiday";

/** Các ngày từ from tới to (gồm cả 2 đầu). */
export function dateRange(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function wageAt(history: { hourlyWage: number; effectiveFrom: string }[], date: string, fallback: number) {
  let w: number | null = null;
  for (const h of history) if (h.effectiveFrom <= date) w = h.hourlyWage;
  return w ?? fallback;
}

/**
 * Lương ước tính theo ngày, tính cho cơ sở NƠI LÀM thực tế:
 * giờ tính công × lương giờ hiệu lực + thưởng − phạt (theo ngày) + phụ cấp trong bảng lương (chia đều các ngày của tháng).
 */
export async function loadLabor(from: string, to: string) {
  await connectDB();
  const atts = await Attendance.find({ workDate: { $gte: from, $lte: to }, status: "COMPLETED" }).select("userId storeId workDate roundedHours").lean();
  const uids = [...new Set(atts.map((a) => String(a.userId)))];
  const users = new Map((await User.find({ _id: { $in: uids } }).select("hourlyWage").lean()).map((u) => [String(u._id), u.hourlyWage || 0]));
  const hist = new Map<string, { hourlyWage: number; effectiveFrom: string }[]>();
  for (const h of await WageHistory.find({ userId: { $in: uids } }).sort({ effectiveFrom: 1 }).lean()) {
    const k = String(h.userId);
    if (!hist.has(k)) hist.set(k, []);
    hist.get(k)!.push(h);
  }
  const holidays = await loadHolidays(from, to);
  const out: PnlInput["labor"] = [];
  const months = [...new Set(dateRange(from, to).map((d) => d.slice(0, 7)))];
  // full-time: lương cứng tháng chia đều các ngày, tính cho cơ sở gốc (đang làm, hoặc có chấm công trong tháng đó)
  const fixedKeys = new Set<string>(); // `${userId}|${month}` → bỏ qua giờ × lương giờ
  const salaryHist = await SalaryHistory.find({ payType: "FULLTIME" }).select("userId").lean();
  const ftUsers = await User.find({ _id: { $in: [...new Set(salaryHist.map((h) => String(h.userId)))] } }).select("storeId status").lean();
  const ftHist = await SalaryHistory.find({ userId: { $in: ftUsers.map((u) => u._id) } }).lean();
  for (const u of ftUsers) {
    const uid = String(u._id);
    for (const m of months) {
      const t = payTermsAt(ftHist.filter((h) => String(h.userId) === uid), m);
      if (t.payType !== "FULLTIME") continue;
      fixedKeys.add(`${uid}|${m}`);
      if (u.status !== "ACTIVE" && !atts.some((a) => String(a.userId) === uid && a.workDate.startsWith(m))) continue;
      if (!u.storeId) continue;
      const perDay = t.monthlySalary / daysInMonth(m);
      for (const d of dateRange(from, to)) if (d.startsWith(m)) out.push({ storeId: String(u.storeId), date: d, amount: perDay });
    }
  }
  for (const a of atts) {
    const uid = String(a.userId);
    if (fixedKeys.has(`${uid}|${a.workDate.slice(0, 7)}`)) continue;
    const w = wageAt(hist.get(uid) ?? [], a.workDate, users.get(uid) ?? 0);
    const mult = holidays.get(a.workDate)?.multiplier ?? 1; // ngày lễ ×2…
    out.push({ storeId: String(a.storeId), date: a.workDate, amount: (a.roundedHours || 0) * w * mult });
  }
  for (const b of await BonusPenalty.find({ date: { $gte: from, $lte: to } }).select("storeId date kind amountVnd").lean())
    out.push({ storeId: String(b.storeId), date: b.date, amount: b.kind === "BONUS" ? b.amountVnd : -b.amountVnd });
  // phụ cấp (chỉ có trong bảng lương) → chia đều cho các ngày của tháng
  for (const it of await PayrollItem.find({ month: { $in: months }, allowance: { $gt: 0 } }).select("storeId month allowance").lean()) {
    const perDay = it.allowance / daysInMonth(it.month);
    for (const d of dateRange(from, to)) if (d.startsWith(it.month)) out.push({ storeId: String(it.storeId), date: d, amount: perDay });
  }
  return out;
}

export type StoreLite = { _id: string; name: string; short: string; grabFeePct: number; shopeeFeePct: number; createdAt?: Date };
export const shortName = (n: string) => n.replace(/^TBS\s*/i, "");

export async function loadStores(): Promise<StoreLite[]> {
  await connectDB();
  return (await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean()).map((s) => ({
    _id: String(s._id),
    name: s.name,
    short: shortName(s.name),
    grabFeePct: s.grabFeePct ?? 0,
    shopeeFeePct: s.shopeeFeePct ?? 0,
    createdAt: s.createdAt as Date | undefined,
  }));
}

/** Doanh thu ngày × cơ sở tính thẳng từ chốt ca (luỹ kế: lấy ca chốt cuối) – nguồn DUY NHẤT cho mọi màn hình / báo cáo. */
export async function loadDayRevenue(from: string, to: string, storeIds?: string[]): Promise<DayRevenueRow[]> {
  await connectDB();
  const q: Record<string, unknown> = { workDate: { $gte: from, $lte: to }, "revenue.tm": { $ne: null } };
  if (storeIds) q.storeId = { $in: storeIds.map((i) => new Types.ObjectId(i)) };
  const closings = await ShiftClosing.find(q).select("storeId workDate shiftName createdAt revenue").lean();
  return dayRevenueFromClosings(closings);
}

/** Lãi lỗ chuỗi + lãi gộp từng cơ sở của kỳ [from, to]. */
export async function loadPnl(from: string, to: string, stores?: StoreLite[]): Promise<{ stores: StoreLite[]; dates: string[]; pnl: PnlResult }> {
  await connectDB();
  const st = stores ?? (await loadStores());
  const ids = st.map((s) => s._id);
  const dates = dateRange(from, to);
  const [rev, exps, fixed, labor] = await Promise.all([
    loadDayRevenue(from, to, ids),
    Expense.find({ date: { $gte: from, $lte: to } }).lean(),
    FixedCost.find({ startMonth: { $lte: to.slice(0, 7) }, $or: [{ endMonth: null }, { endMonth: "" }, { endMonth: { $gte: from.slice(0, 7) } }] }).lean(),
    loadLabor(from, to),
  ]);
  const pnl = computePnl({
    storeIds: ids,
    dates,
    revenue: rev.map((r) => ({ ...r, dt: r.dt ?? 0 })),
    expenses: exps.map((e) => ({
      date: e.date,
      amount: e.amount,
      scope: e.scope ?? "STORE",
      storeId: e.storeId ? String(e.storeId) : null,
      allocation: e.allocation,
      customShares: (e.customShares ?? []).map((c: { storeId?: unknown; pct?: number | null }) => ({ storeId: String(c.storeId), pct: c.pct ?? 0 })),
      paidFrom: e.paidFrom,
      countInCost: e.countInCost,
      category: e.category,
    })),
    fixed: fixed.map((f) => ({
      amountPerMonth: f.amountPerMonth,
      scope: f.scope ?? "STORE",
      storeId: f.storeId ? String(f.storeId) : null,
      allocation: f.allocation,
      customShares: (f.customShares ?? []).map((c: { storeId?: unknown; pct?: number | null }) => ({ storeId: String(c.storeId), pct: c.pct ?? 0 })),
      startMonth: f.startMonth,
      endMonth: f.endMonth,
      category: f.category,
    })),
    labor,
    fees: Object.fromEntries(st.map((s) => [s._id, { grab: s.grabFeePct, shopee: s.shopeeFeePct }])),
  });
  return { stores: st, dates, pnl };
}
