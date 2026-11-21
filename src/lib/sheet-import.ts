/*
 * Import chốt ca THÁNG CŨ từ Google Sheet doanh thu của cơ sở (Chốt ca → Import từ Google Sheet).
 * Hàm thuần (không gọi Google / DB) – đọc tên tab ra tháng, đọc lưới ô ra doanh thu từng ngày.
 * Cột theo đúng mẫu app đang ghi (sheetRowCells – revenue.ts):
 *   GRAB_COL: B DT máy · C TK · D TM · E Thu chi · F Shopee · G Grab · J ghi chú
 *   LEGACY  : B DT máy · C TK · D TM · E Thu chi · F Shopee + Grab (gộp) · I ghi chú
 * Ngày 1 ở dòng firstRow (mặc định 3), ngày d ở dòng firstRow + d − 1.
 */
import type { Revenue, SheetLayout } from "./revenue";

/**
 * Tên tab → tháng "YYYY-MM": "T10-26", "T10/2026", "T 10.26", "Tháng 10 - 2026", "10-2026"; "T10" (không năm) → tháng 10 gần nhất ĐÃ QUA
 * (so với tháng hiện tại curMonth). Không nhận ra → null.
 */
export function tabMonth(title: string, curMonth: string): string | null {
  const t = title.normalize("NFC").trim();
  const m = /^(?:t(?:h[aá]ng)?\s*)?0?(\d{1,2})(?:\s*[-_./ ]\s*(\d{4}|\d{2}))?$/i.exec(t);
  if (!m) return null;
  const mo = Number(m[1]);
  if (mo < 1 || mo > 12) return null;
  // chỉ số trần ("10") mà không có chữ T / Tháng và không có năm → không đoán (dễ nhầm tab khác)
  if (!m[2] && !/^t/i.test(t)) return null;
  const [cy, cm] = curMonth.split("-").map(Number);
  let y: number;
  if (m[2]) y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  else y = mo < cm ? cy : cy - 1; // "T10" lúc đang tháng 11/2026 → 10/2026; lúc tháng 10/2026 → 10/2025
  return `${y}-${String(mo).padStart(2, "0")}`;
}

/** Ô sheet → số tiền. "1.234.000" / "1,234,000" / "1234000" / 1234000 → 1234000; "" / "-" / chữ → null. */
export function cellMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s === "-") return null;
  const neg = /^[-−(]/.test(s);
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return neg ? -n : n;
}

export type SheetDay = { date: string; revenue: Revenue; note: string; row: number };

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const colIdx = (c: string) => c.charCodeAt(0) - 65; // "A" → 0

/**
 * Lưới ô (đọc từ A1) → doanh thu từng ngày của tháng. Bỏ ngày trống (DT máy, TK, TM đều trống / 0).
 * scale: 1000 nếu sheet ghi theo nghìn đồng.
 */
export function parseMonthGrid(grid: unknown[][], opts: { layout: SheetLayout; firstRow: number; month: string; scale?: number }): SheetDay[] {
  const { layout, firstRow, month } = opts;
  const scale = opts.scale && opts.scale > 0 ? opts.scale : 1;
  const out: SheetDay[] = [];
  const noteCol = layout === "LEGACY" ? "I" : "J";
  for (let d = 1; d <= daysIn(month); d++) {
    const row = firstRow + d - 1;
    const r = grid[row - 1] ?? [];
    const get = (c: string) => cellMoney(r[colIdx(c)]);
    const dt = get("B");
    const tk = get("C");
    const tm = get("D");
    if (!dt && !tk && !tm) continue;
    const x = (n: number | null) => (n ?? 0) * scale;
    const revenue: Revenue = {
      dt: x(dt),
      tk: x(tk),
      tm: x(tm),
      cp: x(get("E")),
      shopee: x(get("F")),
      grab: layout === "LEGACY" ? 0 : x(get("G")),
    };
    const n = r[colIdx(noteCol)];
    out.push({ date: `${month}-${String(d).padStart(2, "0")}`, revenue, note: typeof n === "string" ? n.trim().slice(0, 300) : "", row });
  }
  return out;
}

/** Sheet có vẻ ghi theo NGHÌN đồng (DT máy phần lớn < 50.000) → gợi ý nhân 1.000. */
export function looksThousands(days: SheetDay[]) {
  const dts = days.map((d) => d.revenue.dt).filter((n) => n > 0);
  if (!dts.length) return false;
  return dts.filter((n) => n < 50_000).length / dts.length >= 0.8;
}
