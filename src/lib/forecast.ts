/*
 * Dự báo doanh thu từng ca → gợi ý số người / ca (thống kê, không cần AI); AI chỉ viết đoạn giải thích.
 * Doanh thu riêng từng ca lấy từ chốt ca (luỹ kế → shiftDeltas). Doanh thu / người = trung vị lịch sử của từng ca.
 */
import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, ShiftAssignment, ShiftClosing, ShiftTemplate } from "./models";
import { closingSum, shiftDeltas, type Revenue } from "./revenue";
import { addDays, localDate } from "./time";
import { loadHolidays } from "./holiday";

export type ForecastTpl = { id: string; name: string; startTime: string; targetStaff: number; minStaff: number };
export type ShiftRev = { date: string; tplId: string; rev: number; staff: number };
export type ForecastCell = { date: string; tplId: string; rev: number; suggest: number; current: number; samples: number };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

/** Hàm thuần: lịch sử doanh thu từng ca → gợi ý cho các ngày `days`. */
export function forecastStaff(input: {
  history: ShiftRev[];
  templates: ForecastTpl[];
  days: string[];
  holidays: Set<string>;
  pastHolidays: Set<string>;
  maxStaff?: number;
}): { cells: ForecastCell[]; perStaff: Record<string, number>; holidayFactor: number } {
  const { history, templates, days } = input;
  const maxStaff = input.maxStaff ?? 6;
  // doanh thu / người của từng ca (trung vị)
  const perStaff: Record<string, number> = {};
  for (const t of templates) {
    const r = history.filter((h) => h.tplId === t.id && h.staff > 0 && h.rev > 0 && !input.pastHolidays.has(h.date)).map((h) => h.rev / h.staff);
    perStaff[t.id] = median(r);
  }
  // hệ số ngày lễ: doanh thu ngày lễ / ngày thường (cả ngày), không đủ dữ liệu → 1,5
  const dayRev = new Map<string, number>();
  for (const h of history) dayRev.set(h.date, (dayRev.get(h.date) ?? 0) + h.rev);
  const hol = [...dayRev].filter(([d]) => input.pastHolidays.has(d)).map(([, v]) => v);
  const norm = [...dayRev].filter(([d]) => !input.pastHolidays.has(d)).map(([, v]) => v);
  const holidayFactor = hol.length && median(norm) > 0 ? Math.min(3, Math.max(1, median(hol) / median(norm))) : 1.5;

  const cells: ForecastCell[] = [];
  for (const date of days)
    for (const t of templates) {
      // cùng thứ trong tuần, ngày thường; ưu tiên 6 tuần gần nhất
      const same = history
        .filter((h) => h.tplId === t.id && wd(h.date) === wd(date) && !input.pastHolidays.has(h.date) && h.rev > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 6);
      let rev = same.length ? median(same.map((h) => h.rev)) : 0;
      if (input.holidays.has(date)) rev *= holidayFactor;
      const ps = perStaff[t.id];
      const suggest = rev > 0 && ps > 0 ? Math.min(maxStaff, Math.max(1, Math.round(rev / ps))) : Math.max(t.targetStaff, t.minStaff, 1);
      cells.push({ date, tplId: t.id, rev: Math.round(rev), suggest, current: Math.max(t.targetStaff, t.minStaff), samples: same.length });
    }
  return { cells, perStaff, holidayFactor };
}

/** Nạp lịch sử 12 tuần của cơ sở + dự báo tuần `weekStart`. */
export async function loadForecast(storeId: string, weekStart: string) {
  await connectDB();
  const sid = new Types.ObjectId(storeId);
  const today = localDate(new Date());
  const from = addDays(today, -84);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [tplDocs, closings, assigns, futureHol, pastHol] = await Promise.all([
    ShiftTemplate.find({ storeId: sid, active: { $ne: false } }).sort({ startTime: 1 }).lean(),
    ShiftClosing.find({ storeId: sid, workDate: { $gte: from, $lt: today }, "revenue.tm": { $ne: null } }).select("workDate shiftName shiftStart revenue createdAt").lean(),
    ShiftAssignment.find({ storeId: sid, date: { $gte: from, $lt: today }, ...APPROVED_SHIFT }).select("date shiftTemplateId").lean(),
    loadHolidays(days[0], days[6]),
    loadHolidays(from, today),
  ]);
  const templates: ForecastTpl[] = tplDocs.map((t) => ({ id: String(t._id), name: t.name, startTime: t.startTime, targetStaff: t.targetStaff ?? 0, minStaff: t.minStaff ?? 0 }));
  const tplOf = (c: { shiftName?: string | null; shiftStart?: string | null }) =>
    templates.find((t) => c.shiftStart && t.startTime === c.shiftStart) ?? templates.find((t) => c.shiftName && t.name.toLowerCase() === c.shiftName.toLowerCase());
  const staffCount = new Map<string, number>();
  for (const a of assigns) staffCount.set(`${a.date}|${a.shiftTemplateId}`, (staffCount.get(`${a.date}|${a.shiftTemplateId}`) ?? 0) + 1);
  const byDay = new Map<string, typeof closings>();
  for (const c of closings) (byDay.get(c.workDate) ?? byDay.set(c.workDate, []).get(c.workDate)!).push(c);
  const history: ShiftRev[] = [];
  for (const [date, list] of byDay)
    for (const { closing, own } of shiftDeltas(list.map((c) => ({ ...c, revenue: (c.revenue ?? {}) as Partial<Revenue> })))) {
      const t = tplOf(closing);
      if (t) history.push({ date, tplId: t.id, rev: closingSum(own), staff: staffCount.get(`${date}|${t.id}`) ?? 0 });
    }
  const res = forecastStaff({ history, templates, days, holidays: new Set(futureHol.keys()), pastHolidays: new Set(pastHol.keys()) });
  return { ...res, templates, days, holidayNames: Object.fromEntries([...futureHol].map(([d, h]) => [d, h.name])), weeks: Math.round(new Set(history.map((h) => h.date)).size / 7) };
}
