import { Types } from "mongoose";
import { connectDB } from "./db";
import { Attendance, BonusPenalty, Payroll, PayrollItem, SalaryHistory, Store, User, WageHistory, type ExtrasNote } from "./models";
import { payTermsAt } from "./salary";
import { computePay } from "./calc";
import { holidayNote, loadHolidays } from "./holiday";
import { payStoreFilter } from "./attendance";
import { localDate, localMonth, monthRange, nextMonth, prevMonth } from "./time";

/* Bảng lương tháng – spec 3.7 */

/** Lương giờ hiệu lực tại một ngày. */
function wageAt(history: { hourlyWage: number; effectiveFrom: string }[], date: string, fallback: number) {
  let w: number | null = null;
  for (const h of history) if (h.effectiveFrom <= date) w = h.hourlyWage; // history sắp xếp tăng dần
  return w ?? fallback;
}

/**
 * Tạo (nếu chưa có) + tính lại bảng lương (nháp lẫn đã công bố – "Công bố" chỉ là cho nhân viên xem, KHÔNG chốt số,
 * sửa tiếp thì nhân viên thấy luôn số mới; không lưu bản cũ). KHÔNG tính lại dòng đã trả (paidAt) và bảng "Đã trả".
 * Giữ nguyên phụ cấp / tạm ứng admin đã nhập.
 */
export async function generatePayroll(storeId: string, month: string, opts: { force?: boolean } = {}) {
  await connectDB();
  let payroll = await Payroll.findOne({ storeId, month });
  if (!payroll) payroll = await Payroll.create({ storeId, month, status: "DRAFT" });
  if (payroll.status === "PAID") return payroll;
  void opts.force; // giữ tham số cho chỗ gọi cũ – giờ luôn tính lại

  const atts = await Attendance.find({ month, status: "COMPLETED", ...payStoreFilter(storeId) }).lean();
  const bps = await BonusPenalty.find({ storeId, month }).lean();
  const supportStores = new Map(
    (await Store.find({ _id: { $in: [...new Set(atts.filter((a) => String(a.storeId) !== storeId).map((a) => a.storeId))] } }).select("name").lean()).map((s) => [String(s._id), s.name]),
  );
  const userIds = new Set<string>([...atts.map((a) => String(a.userId)), ...bps.map((b) => String(b.userId))]);
  // nhân viên đang làm tại cơ sở cũng có dòng (0 giờ)
  const staff = await User.find({ storeId, status: "ACTIVE" }).select("_id").lean();
  staff.forEach((u) => userIds.add(String(u._id)));

  const { first, last } = monthRange(month);
  const holidays = await loadHolidays(first, last);
  const existing = await PayrollItem.find({ payrollId: payroll._id }).lean();
  const keep = new Map(existing.map((i) => [String(i.userId), i]));

  // giờ đi hỗ trợ cơ sở khác (vẫn do cơ sở gốc trả lương)
  const support = (list: typeof atts) => {
    const by = new Map<string, number>();
    for (const a of list) if (String(a.storeId) !== storeId) by.set(String(a.storeId), (by.get(String(a.storeId)) ?? 0) + (a.roundedHours || 0));
    const supportHours = [...by.values()].reduce((x, y) => x + y, 0);
    const supportNote = [...by].map(([id, h]) => `${supportStores.get(id) ?? "?"} ${h}h`).join(", ");
    return { supportHours, supportNote };
  };

  for (const uid of userIds) {
    const user = await User.findById(uid).lean();
    if (!user) continue;
    const history = await WageHistory.find({ userId: uid }).sort({ effectiveFrom: 1 }).lean();
    // full-time: lương cơ bản = lương cứng tháng (giờ công vẫn đếm để theo dõi, không nhân lương giờ / hệ số lễ)
    const terms = payTermsAt(await SalaryHistory.find({ userId: uid }).lean(), month);
    const fulltime = terms.payType === "FULLTIME";
    const myAtts = atts.filter((a) => String(a.userId) === uid);
    const myBps = bps.filter((b) => String(b.userId) === uid);
    const hoursByWage = myAtts.map((a) => ({
      hours: a.roundedHours || 0,
      wage: fulltime ? 0 : wageAt(history, a.workDate, user.hourlyWage || 0),
      mult: fulltime ? 1 : (holidays.get(a.workDate)?.multiplier ?? 1), // ngày lễ ×2 / ×3 / ×4
    }));
    const totalBonus = myBps.filter((b) => b.kind === "BONUS").reduce((s, b) => s + b.amountVnd, 0);
    const totalPenalty = myBps.filter((b) => b.kind === "PENALTY").reduce((s, b) => s + b.amountVnd, 0);
    const prev = keep.get(uid);
    if (prev?.paidAt) continue; // đã trả → giữ nguyên số đã trả
    const allowance = prev?.allowance ?? 0;
    const advance = prev?.advance ?? 0;
    const { totalHours, basePay, netPay, holidayHours, holidayExtra } = computePay({ hoursByWage, allowance, totalBonus, totalPenalty, advance, fixedBasePay: fulltime ? terms.monthlySalary : undefined });
    await PayrollItem.updateOne(
      { payrollId: payroll._id, userId: uid },
      {
        $set: {
          storeId,
          month,
          totalHours,
          workDays: new Set(myAtts.map((a) => a.workDate)).size,
          hourlyWage: fulltime ? 0 : wageAt(history, monthRange(month).last, user.hourlyWage || 0), // lương giờ áp dụng cuối tháng này
          payType: terms.payType,
          monthlySalary: terms.monthlySalary,
          paidLeaveDays: terms.paidLeaveDays,
          basePay,
          totalBonus,
          totalPenalty,
          netPay,
          allowance,
          advance,
          lateCount: myAtts.filter((a) => (a.lateMinutes || 0) > 0).length,
          earlyCount: myAtts.filter((a) => (a.earlyMinutes || 0) > 0).length,
          ...support(myAtts),
          holidayHours,
          holidayExtra,
          holidayNote: fulltime ? "" : holidayNote(myAtts, holidays),
          userName: user.name,
          bankName: user.bankName ?? "",
          bankAccountEnc: user.bankAccountEnc ?? "",
          bpDetails: [...myBps]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((b) => ({ kind: b.kind, date: b.date, content: b.content ?? "", amountVnd: b.amountVnd })),
        },
      },
      { upsert: true },
    );
  }
  payroll.calculatedAt = new Date();
  await payroll.save();
  return payroll;
}

export async function updateItemExtras(itemId: string, allowance: number, advance: number) {
  const item = await PayrollItem.findById(itemId);
  if (!item) throw new Error("Không tìm thấy dòng lương");
  const p = await Payroll.findById(item.payrollId).lean();
  if (p?.status === "PAID" || item.paidAt) throw new Error("Đã trả lương – mở khoá (nhập lý do) trước khi sửa");
  item.allowance = Math.max(0, Math.round(allowance));
  item.advance = Math.max(0, Math.round(advance));
  item.netPay = item.basePay + item.allowance + item.totalBonus - item.totalPenalty - item.advance;
  await item.save();
}

type ExtraField = "allowance" | "advance";
async function editableItem(itemId: string) {
  const item = await PayrollItem.findById(itemId);
  if (!item) throw new Error("Không tìm thấy dòng lương");
  const p = await Payroll.findById(item.payrollId).lean();
  if (p?.status === "PAID" || item.paidAt) throw new Error("Đã trả lương – mở khoá (nhập lý do) trước khi sửa");
  return item;
}

/** Cộng thêm các khoản phụ cấp / tạm ứng (mỗi khoản có số tiền + nội dung) vào 1 dòng lương. */
export async function addItemExtras(itemId: string, field: ExtraField, rows: { amount: number; note: string }[], by: string) {
  const item = await editableItem(itemId);
  const list = rows.map((r) => ({ amount: Math.round(r.amount), note: r.note.trim().slice(0, 200) })).filter((r) => r.amount > 0);
  if (!list.length) throw new Error("Nhập số tiền");
  if (list.some((r) => r.amount > 100_000_000)) throw new Error("Số tiền quá lớn");
  const sum = list.reduce((s, r) => s + r.amount, 0);
  item[field] = (item[field] || 0) + sum;
  item.netPay = item.basePay + item.allowance + item.totalBonus - item.totalPenalty - item.advance;
  item.extrasNotes.push(...list.map((r) => ({ field, amount: r.amount, note: r.note, by, at: new Date() })));
  await item.save();
  return sum;
}

/**
 * Xoá 1 khoản phụ cấp / tạm ứng: index = vị trí trong extrasNotes; -1 = phần nhập tay không có ghi chú
 * (tổng cột − Σ các khoản có ghi chú). Trừ đúng số tiền khoản đó khỏi cột.
 */
export async function removeItemExtra(itemId: string, field: ExtraField, index: number) {
  const item = await editableItem(itemId);
  const notes = item.extrasNotes ?? [];
  let amount: number;
  if (index === -1) {
    amount = (item[field] || 0) - (notes as ExtrasNote[]).filter((n) => n.field === field).reduce((s, n) => s + (n.amount ?? 0), 0);
  } else {
    const n = notes[index];
    if (!n || n.field !== field) throw new Error("Khoản này đã thay đổi – tải lại trang");
    amount = n.amount ?? 0;
    notes.splice(index, 1);
  }
  item[field] = Math.max(0, (item[field] || 0) - Math.max(0, amount));
  item.netPay = item.basePay + item.allowance + item.totalBonus - item.totalPenalty - item.advance;
  await item.save();
  return amount;
}

export async function publishPayroll(payrollId: Types.ObjectId | string, by: string) {
  const p = await Payroll.findById(payrollId);
  if (!p || p.status !== "DRAFT") return null;
  await generatePayroll(String(p.storeId), p.month); // tính lại lần cuối
  p.status = "PUBLISHED";
  p.publishedAt = new Date();
  p.publishedBy = by;
  await p.save();
  return p;
}

/** Tháng cần công bố vào ngày 5: tháng trước của "hôm nay" (theo múi giờ cơ sở). */
export function payrollMonthForPublishDay(now: Date, tz: string) {
  return prevMonth(localMonth(now, tz));
}

/** Cron 00:00 ngày 5: tự công bố bảng lương tháng trước của mọi cơ sở (spec 3.7). */
export async function autoPublishPayrolls(now = new Date()) {
  await connectDB();
  const stores = await Store.find({ active: true }).lean();
  const done: string[] = [];
  for (const s of stores) {
    const tz = s.timezone || "Asia/Ho_Chi_Minh";
    // chỉ chạy đúng ngày 5 – tránh tự công bố lại khi admin đã mở khoá để sửa sau ngày 5
    if (Number(localDate(now, tz).slice(8, 10)) !== 5) continue;
    const month = payrollMonthForPublishDay(now, tz);
    const p = (await Payroll.findOne({ storeId: s._id, month })) ?? (await generatePayroll(String(s._id), month));
    if (p.status === "DRAFT" && !p.unlockedAt) {
      await publishPayroll(p._id, "Hệ thống (tự động ngày 5)");
      done.push(`${s.name} ${month}`);
    }
  }
  return done;
}

/** Từ ngày 1 tháng N+1 tạo sẵn bảng lương nháp tháng N. */
export async function ensureDraftPayrolls(now = new Date()) {
  await connectDB();
  const stores = await Store.find({ active: true }).lean();
  for (const s of stores) {
    const month = prevMonth(localMonth(now, s.timezone || "Asia/Ho_Chi_Minh"));
    const p = await Payroll.findOne({ storeId: s._id, month }).lean();
    if (!p) await generatePayroll(String(s._id), month);
  }
}

export { nextMonth };

/**
 * Lương TẠM TÍNH của 1 cơ sở trong tháng (tới thời điểm hiện tại) – dùng cho Tổng quan.
 * = Σ giờ tính công (lượt đã check-out) × lương giờ hiệu lực × hệ số ngày lễ + thưởng − phạt.
 * Chưa gồm phụ cấp / tạm ứng (chỉ có khi lập bảng lương).
 */
export async function estimateStorePay(storeId: Types.ObjectId | string, month: string) {
  await connectDB();
  const atts = await Attendance.find({ storeId, month, status: "COMPLETED" }).select("userId workDate roundedHours").lean();
  const { first, last } = monthRange(month);
  const holidays = await loadHolidays(first, last);
  const bps = await BonusPenalty.find({ storeId, month }).select("kind amountVnd").lean();
  const uids = [...new Set(atts.map((a) => String(a.userId)))];
  const users = await User.find({ _id: { $in: uids } }).select("hourlyWage").lean();
  const histories = await WageHistory.find({ userId: { $in: uids } }).sort({ effectiveFrom: 1 }).lean();
  // full-time: lương cứng cả tháng của nhân viên đang làm tại cơ sở (không tính theo giờ)
  const fixed = await fulltimeOfStore(storeId, month);
  let hours = 0;
  let basePay = [...fixed.values()].reduce((s, v) => s + v, 0);
  for (const a of atts) {
    if (fixed.has(String(a.userId))) {
      hours += a.roundedHours || 0;
      continue;
    }
    const u = users.find((x) => String(x._id) === String(a.userId));
    const h = histories.filter((x) => String(x.userId) === String(a.userId));
    const w = wageAt(h, a.workDate, u?.hourlyWage || 0);
    hours += a.roundedHours || 0;
    basePay += (a.roundedHours || 0) * w * (holidays.get(a.workDate)?.multiplier ?? 1);
  }
  const bonus = bps.filter((b) => b.kind === "BONUS").reduce((s, b) => s + b.amountVnd, 0);
  const penalty = bps.filter((b) => b.kind === "PENALTY").reduce((s, b) => s + b.amountVnd, 0);
  basePay = Math.round(basePay);
  return { hours: Math.round(hours * 100) / 100, basePay, bonus, penalty, total: basePay + bonus - penalty, staffCount: new Set([...uids, ...fixed.keys()]).size };
}

/** Nhân viên full-time đang làm tại cơ sở trong tháng → lương cứng (userId → VND). */
export async function fulltimeOfStore(storeId: Types.ObjectId | string, month: string) {
  await connectDB();
  const staff = await User.find({ storeId, status: "ACTIVE" }).select("_id").lean();
  const hist = await SalaryHistory.find({ userId: { $in: staff.map((u) => u._id) } }).lean();
  const out = new Map<string, number>();
  for (const u of staff) {
    const t = payTermsAt(hist.filter((h) => String(h.userId) === String(u._id)), month);
    if (t.payType === "FULLTIME") out.set(String(u._id), t.monthlySalary);
  }
  return out;
}
