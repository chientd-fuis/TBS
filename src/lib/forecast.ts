/*
 * Dự báo doanh thu từng ca → gợi ý số người / ca (thống kê, không cần AI); AI chỉ viết đoạn giải thích.
 * Doanh thu riêng từng ca lấy từ chốt ca (luỹ kế → shiftDeltas). Doanh thu / người = trung vị lịch sử của từng ca.
 */
import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, ShiftAssignment, ShiftClosing, ShiftTemplate } from "./models";
import { closingSum, shiftDeltas, type Revenue } from "./revenue";
import { addDays, localDate, weekStartOf } from "./time";
import { loadHolidays } from "./holiday";
import { loadWeather, weatherAdvice, weatherKind, WEATHER_FACTOR, type DayWeather, type WeatherFactors, type WeatherKind } from "./weather";
import { Store } from "./models";

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
  /** hệ số thời tiết theo ngày (mưa / lạnh < 1) – quán kem chè vắng khách */
  weatherFactor?: Map<string, number>;
  /** loại thời tiết các ngày đã qua – mức nền "cùng thứ" chỉ lấy ngày thời tiết bình thường (nếu đủ ≥ 2 ngày) */
  pastKind?: Map<string, WeatherKind>;
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
      let same = history
        .filter((h) => h.tplId === t.id && wd(h.date) === wd(date) && !input.pastHolidays.has(h.date) && h.rev > 0)
        .sort((a, b) => b.date.localeCompare(a.date));
      const fine = same.filter((h) => (input.pastKind?.get(h.date) ?? "normal") === "normal");
      same = (fine.length >= 2 ? fine : same).slice(0, 6);
      let rev = same.length ? median(same.map((h) => h.rev)) : 0;
      if (input.holidays.has(date)) rev *= holidayFactor;
      rev *= input.weatherFactor?.get(date) ?? 1;
      const ps = perStaff[t.id];
      const suggest = rev > 0 && ps > 0 ? Math.min(maxStaff, Math.max(1, Math.round(rev / ps))) : Math.max(t.targetStaff, t.minStaff, 1);
      cells.push({ date, tplId: t.id, rev: Math.round(rev), suggest, current: Math.max(t.targetStaff, t.minStaff), samples: same.length });
    }
  return { cells, perStaff, holidayFactor };
}

export type WeatherImpact = Record<Exclude<WeatherKind, "normal">, { factor: number; samples: number; learned: boolean }>;

/**
 * Hàm thuần: học ảnh hưởng thời tiết lên doanh thu của chính quán.
 * Mỗi ngày đã qua (không phải ngày lễ) có mưa / lạnh: tỉ lệ = doanh thu cả ngày / trung vị doanh thu các ngày CÙNG THỨ thời tiết bình thường.
 * Hệ số = trung vị tỉ lệ (giới hạn 0,3–1,1); < 3 ngày mẫu → dùng mặc định (WEATHER_FACTOR). "Mưa + lạnh" thiếu mẫu → mưa × lạnh.
 */
export function learnWeatherImpact(history: ShiftRev[], pastKind: Map<string, WeatherKind>, pastHolidays: Set<string>): WeatherImpact {
  const dayRev = new Map<string, number>();
  for (const h of history) if (!pastHolidays.has(h.date)) dayRev.set(h.date, (dayRev.get(h.date) ?? 0) + h.rev);
  const ratios: Record<string, number[]> = { rain: [], cold: [], both: [] };
  for (const [date, rev] of dayRev) {
    const kind = pastKind.get(date);
    if (!kind || kind === "normal" || rev <= 0) continue;
    const base = [...dayRev].filter(([d, v]) => d !== date && v > 0 && wd(d) === wd(date) && pastKind.get(d) === "normal").map(([, v]) => v);
    if (base.length >= 2) ratios[kind].push(rev / median(base));
  }
  const pick = (k: "rain" | "cold") =>
    ratios[k].length >= 3 ? { factor: Math.min(1.1, Math.max(0.3, median(ratios[k]))), samples: ratios[k].length, learned: true } : { factor: WEATHER_FACTOR[k], samples: ratios[k].length, learned: false };
  const rain = pick("rain");
  const cold = pick("cold");
  const both =
    ratios.both.length >= 3
      ? { factor: Math.min(1.1, Math.max(0.3, median(ratios.both))), samples: ratios.both.length, learned: true }
      : { factor: rain.learned || cold.learned ? Math.max(0.3, rain.factor * cold.factor) : WEATHER_FACTOR.both, samples: ratios.both.length, learned: false };
  return { rain, cold, both };
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
  // thời tiết thực tế 12 tuần qua → học ảnh hưởng lên doanh thu; dự báo tuần này × hệ số đã học
  const store = await Store.findById(sid).select("lat lng").lean();
  const allWeather = await loadWeather(null, store?.lat, store?.lng);
  const pastKind = new Map([...allWeather].filter(([d]) => d < today).map(([d, w]) => [d, weatherKind(w, true)]));
  const impact = learnWeatherImpact(history, pastKind, new Set(pastHol.keys()));
  const factors: WeatherFactors = { rain: impact.rain.factor, cold: impact.cold.factor, both: impact.both.factor };
  const weather = new Map([...allWeather].filter(([d]) => days.includes(d)));
  const weatherFactor = new Map([...weather].filter(([d]) => d >= today).map(([d, w]) => [d, weatherAdvice(w, factors).factor]));
  const res = forecastStaff({ history, templates, days, holidays: new Set(futureHol.keys()), pastHolidays: new Set(pastHol.keys()), weatherFactor, pastKind });
  // số người ĐANG xếp (đã duyệt) từng ca trong tuần – để so với gợi ý
  const assigned: Record<string, number> = {};
  for (const a of await ShiftAssignment.find({ storeId: sid, date: { $gte: days[0], $lte: days[6] }, ...APPROVED_SHIFT }).select("date shiftTemplateId").lean())
    assigned[`${a.date}|${a.shiftTemplateId}`] = (assigned[`${a.date}|${a.shiftTemplateId}`] ?? 0) + 1;
  return { ...res, templates, days, today, impact, factors, assigned, weather: Object.fromEntries(weather) as Record<string, DayWeather>, holidayNames: Object.fromEntries([...futureHol].map(([d, h]) => [d, h.name])), weeks: Math.round(new Set(history.map((h) => h.date)).size / 7) };
}

export type WeatherCut = { tplId: string; tplName: string; suggest: number; planned: number; rev: number };
export type WeatherDayAlert = { date: string; warn: string; dropPct: number; cuts: WeatherCut[] };

/**
 * Tổng quan: các ngày còn lại của tuần đang chạy (hôm nay → CN) có mưa > 60% / lạnh < 22°C
 * → ca nào nên giảm người, còn bao nhiêu (so với số đang xếp; chưa xếp thì so định mức).
 * Thời tiết tốt cả tuần → không nạp dự báo doanh thu (nhẹ).
 */
export async function weekWeatherAlerts(storeId: string, tz = "Asia/Ho_Chi_Minh"): Promise<WeatherDayAlert[]> {
  await connectDB();
  const today = localDate(new Date(), tz);
  const ws = weekStartOf(today);
  const rest = Array.from({ length: 7 }, (_, i) => addDays(ws, i)).filter((d) => d >= today);
  const store = await Store.findById(storeId).select("lat lng").lean();
  const weather = await loadWeather(rest, store?.lat, store?.lng);
  if (![...weather.values()].some((w) => weatherKind(w) !== "normal")) return [];
  const f = await loadForecast(storeId, ws);
  return rest.flatMap((date) => {
    const w = weather.get(date);
    const a = w && weatherAdvice(w, f.factors);
    if (!a?.reduce) return [];
    const cuts = f.templates.flatMap((t) => {
      const c = f.cells.find((x) => x.date === date && x.tplId === t.id);
      const planned = f.assigned[`${date}|${t.id}`] ?? c?.current ?? 0;
      return c && c.suggest < planned ? [{ tplId: t.id, tplName: t.name, suggest: c.suggest, planned, rev: c.rev }] : [];
    });
    return [{ date, warn: a.text.replace(/ → nên giảm ca$/, ""), dropPct: Math.round((1 - a.factor) * 100), cuts }];
  });
}
