import { connectDB } from "./db";
import { Holiday } from "./models";

/* Ngày nghỉ lễ: đi làm ngày lễ được nhân lương giờ (mặc định ×2). */

export const HOLIDAY_MULTIPLIERS = [2, 3, 4] as const;
export const DEFAULT_HOLIDAY_MULTIPLIER = 2;

export type HolidayInfo = { name: string; multiplier: number };

/** Ngày lễ trong khoảng [from, to] → Map ngày → { tên, hệ số }. */
export async function loadHolidays(from: string, to: string): Promise<Map<string, HolidayInfo>> {
  await connectDB();
  const list = await Holiday.find({ date: { $gte: from, $lte: to } }).select("date name multiplier").lean();
  return new Map(list.map((h) => [h.date, { name: h.name, multiplier: h.multiplier || DEFAULT_HOLIDAY_MULTIPLIER }]));
}

/** Ghi chú bảng lương: "Quốc khánh 02/09 8h ×2, …" (gộp theo ngày). */
export function holidayNote(atts: { workDate: string; roundedHours?: number | null }[], holidays: Map<string, HolidayInfo>) {
  const by = new Map<string, number>();
  for (const a of atts) if (holidays.has(a.workDate)) by.set(a.workDate, (by.get(a.workDate) ?? 0) + (a.roundedHours || 0));
  return [...by]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, h]) => {
      const x = holidays.get(d)!;
      return `${x.name} ${d.slice(8)}/${d.slice(5, 7)} ${Math.round(h * 100) / 100}h ×${x.multiplier}`;
    })
    .join(", ");
}
