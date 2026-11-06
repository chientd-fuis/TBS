/** Tiện ích thời gian theo múi giờ của cơ sở (dùng Intl, không cần thư viện). */

export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || "Asia/Ho_Chi_Minh";

function parts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return { y: o.year, m: o.month, d: o.day, hh: o.hour, mm: o.minute, ss: o.second };
}

/** YYYY-MM-DD theo múi giờ */
export function localDate(date: Date, tz = DEFAULT_TZ) {
  const p = parts(date, tz);
  return `${p.y}-${p.m}-${p.d}`;
}
/** YYYY-MM theo múi giờ */
export function localMonth(date: Date, tz = DEFAULT_TZ) {
  return localDate(date, tz).slice(0, 7);
}
/** HH:mm:ss theo múi giờ */
export function localTime(date: Date | null | undefined, tz = DEFAULT_TZ) {
  if (!date) return "";
  const p = parts(date, tz);
  return `${p.hh}:${p.mm}:${p.ss}`;
}
/** dd/MM/yyyy từ YYYY-MM-DD */
export function viDate(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
export function viDateTime(date: Date | null | undefined, tz = DEFAULT_TZ) {
  if (!date) return "";
  return `${viDate(localDate(date, tz))} ${localTime(date, tz)}`;
}

/** Độ lệch múi giờ (phút) của tz tại thời điểm date. */
function tzOffsetMinutes(date: Date, tz: string) {
  const p = parts(date, tz);
  const asUTC = Date.UTC(+p.y, +p.m - 1, +p.d, +p.hh, +p.mm, +p.ss);
  return Math.round((asUTC - date.getTime()) / 60000);
}

/** Chuyển "YYYY-MM-DD" + "HH:mm[:ss]" (giờ địa phương của tz) → Date (UTC). */
export function zonedToDate(ymd: string, hms: string, tz = DEFAULT_TZ) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm, ss = 0] = hms.split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  const off1 = tzOffsetMinutes(guess, tz);
  const t = new Date(guess.getTime() - off1 * 60000);
  const off2 = tzOffsetMinutes(t, tz);
  return off1 === off2 ? t : new Date(guess.getTime() - off2 * 60000);
}

export function addDays(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { first, last };
}
export function daysOfMonth(month: string) {
  const { first, last } = monthRange(month);
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}
export function prevMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 2, 1));
  return dt.toISOString().slice(0, 7);
}
export function nextMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 1));
  return dt.toISOString().slice(0, 7);
}
export function viMonth(month: string) {
  const [y, m] = month.split("-");
  return `${m}/${y}`;
}

/** Thứ 2 của tuần chứa ngày ymd (YYYY-MM-DD). */
export function weekStartOf(ymd: string) {
  const wd = new Date(ymd + "T00:00:00Z").getUTCDay();
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}
export function weekDays(weekStart: string) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}
export const WEEKDAY_VI = ["Chủ Nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
export function weekdayVi(ymd: string) {
  return WEEKDAY_VI[new Date(ymd + "T00:00:00Z").getUTCDay()];
}
export function isYmd(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
