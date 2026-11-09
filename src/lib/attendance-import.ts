/* Chấm công hộ hàng loạt: đọc file Excel chấm công (mỗi nhân viên 1 sheet), kết quả AI đọc ảnh, sinh lượt theo ca. Hàm thuần – test được. */
import { foldVi } from "./finance";

/** 1 lượt làm việc đọc được (chưa gắn nhân viên). */
export type ImportSession = { date: string; inTime: string; outTime: string | null; shift?: string; warn?: string };
export type ParsedSheet = { sheet: string; name: string; sessions: ImportSession[]; warnings: string[] };

/** Ô của bảng: v = giá trị (ô gộp → giá trị ô gốc), m = địa chỉ ô gốc nếu thuộc vùng gộp. */
export type GridCell = { v: unknown; m?: string } | undefined;

const pad = (n: number) => String(n).padStart(2, "0");
const fold = (s: unknown) => foldVi(String(s ?? "")).trim();
const text = (v: unknown): string => {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as { richText?: { text: string }[]; result?: unknown; text?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result != null) return text(o.result);
    if (o.text != null) return String(o.text);
  }
  return String(v);
};
const unwrap = (v: unknown): unknown => (v && typeof v === "object" && !(v instanceof Date) && "result" in (v as object) ? (v as { result: unknown }).result : v);

/** "08:12", "8h12", "08:12:30", Date (Excel giờ), số (phần ngày) → "HH:mm". */
export function parseTime(raw: unknown): string | null {
  const v = unwrap(raw);
  if (v == null || v === "") return null;
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  if (typeof v === "number") {
    if (v < 0 || v >= 1) return null;
    const m = Math.round(v * 1440);
    return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
  }
  const m = /^\s*(\d{1,2})\s*[:hH.g]\s*(\d{1,2})?/.exec(text(v));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

/** "01/11/2026", "1/11", Date, số serial Excel → "YYYY-MM-DD". Thiếu năm → lấy năm của tháng tham chiếu. */
export function parseDate(raw: unknown, refMonth?: string): string | null {
  const v = unwrap(raw);
  if (v == null || v === "") return null;
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = text(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{2,4}))?/.exec(s);
  if (!m) return null;
  let y = m[3] ? Number(m[3]) : Number(refMonth?.slice(0, 4) || new Date().getFullYear());
  if (y < 100) y += 2000;
  return valid(y, +m[2], +m[1]);
}
function valid(y: number, mo: number, d: number) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 ? `${y}-${pad(mo)}-${pad(d)}` : null;
}

/** Số phút làm (qua đêm thì cộng 24h). */
export function spanMinutes(inTime: string, outTime: string) {
  const a = +inTime.slice(0, 2) * 60 + +inTime.slice(3, 5);
  let b = +outTime.slice(0, 2) * 60 + +outTime.slice(3, 5);
  if (b <= a) b += 1440;
  return b - a;
}
/** > 16 tiếng mới cảnh báo (quán làm 08:00–23:00 ≈ 15 tiếng là bình thường) */
export const LONG_SHIFT_MIN = 16 * 60;

function warnOf(s: ImportSession) {
  if (!s.outTime) return "Thiếu giờ ra";
  if (spanMinutes(s.inTime, s.outTime) > LONG_SHIFT_MIN) return "Ca dài bất thường (quên check-out?)";
  return undefined;
}

/**
 * Mẫu 2 (Google Sheet tự làm): mỗi dòng 1 lượt – Ngày | Giờ Đến | Giờ Về | Tổng | Format | …; tên sheet = tên nhân viên (VD Le_Thi_Nga).
 * Dòng thiếu giờ đến bị bỏ qua; thiếu giờ về = chưa check-out.
 */
function parseRowSheet(grid: GridCell[][], headerRow: number, col: { date: number; in: number; out: number }, out: ParsedSheet, refMonth?: string) {
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const date = parseDate(row[col.date]?.v, refMonth);
    const inTime = parseTime(row[col.in]?.v);
    if (!date || !inTime) continue;
    const s: ImportSession = { date, inTime, outTime: parseTime(row[col.out]?.v) };
    const w = warnOf(s);
    if (w) s.warn = w;
    out.sessions.push(s);
  }
  if (!out.sessions.length) out.warnings.push("Không có lượt chấm công nào");
  return out;
}

/**
 * Đọc 1 sheet theo mẫu file chấm công:
 *   tiêu đề "Thời Gian Chấm Công - <Tên>", "Từ dd/mm/yyyy đến …"
 *   hàng tiêu đề: Ngày | Thời gian | Hình thức chấm công | Đi trễ | Về sớm | Tổng thời gian | Ca làm việc | Tiền công
 *   mỗi lượt = 2 dòng (vào, ra) – các cột Ca làm việc / Tổng thời gian gộp 2 dòng; "Chưa kết thúc chấm công" = thiếu giờ ra.
 */
export function parseSheetGrid(grid: GridCell[][], sheetName: string): ParsedSheet | null {
  const out: ParsedSheet = {
    sheet: sheetName,
    // "1_Nga Le" → "Nga Le" · "Le_Thi_Nga" → "Le Thi Nga"
    name: sheetName.replace(/^\s*\d+\s*[_.\-\s]\s*/, "").replace(/_+/g, " ").trim(),
    sessions: [],
    warnings: [],
  };
  let refMonth: string | undefined;
  let headerRow = -1;
  const col = { date: -1, time: -1, method: -1, shift: -1, total: -1 };
  for (let r = 0; r < Math.min(grid.length, 30) && headerRow < 0; r++) {
    const row = grid[r] ?? [];
    const cells = row.map((c) => fold(text(c?.v)));
    for (const t of row.map((c) => text(c?.v))) {
      const nm = /th[oờ]i\s*gian\s*ch[aấ]m\s*c[oô]ng\s*[-–:]\s*(.+)$/i.exec(t.normalize("NFC"));
      if (nm) out.name = nm[1].trim();
      const pm = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/.exec(t);
      if (pm && /^\s*t[uừ]/i.test(t.normalize("NFC"))) refMonth = `${pm[3]}-${pad(+pm[2])}`;
    }
    const iDate = cells.findIndex((c) => c === "NGAY");
    // mẫu 2: mỗi dòng 1 lượt (Giờ Đến / Giờ Về)
    const iIn = cells.findIndex((c) => ["GIO DEN", "GIO VAO", "CHECK IN", "VAO"].includes(c));
    const iOut = cells.findIndex((c) => ["GIO VE", "GIO RA", "CHECK OUT", "RA"].includes(c));
    if (iDate >= 0 && iIn >= 0 && iOut >= 0) return parseRowSheet(grid, r, { date: iDate, in: iIn, out: iOut }, out, refMonth);
    const iTime = cells.findIndex((c) => c === "THOI GIAN" || c === "GIO");
    if (iDate >= 0 && iTime >= 0) {
      headerRow = r;
      col.date = iDate;
      col.time = iTime;
      col.method = cells.findIndex((c) => c.includes("HINH THUC"));
      col.shift = cells.findIndex((c) => c.startsWith("CA LAM") || c === "CA");
      col.total = cells.findIndex((c) => c.startsWith("TONG THOI GIAN"));
    }
  }
  if (headerRow < 0) return null;

  type Group = { date: string; key: string | null; times: string[]; open: boolean; shift?: string };
  const groups: Group[] = [];
  const pairCol = col.shift >= 0 ? col.shift : col.total;
  let curDate: string | null = null;
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const d = parseDate(row[col.date]?.v, refMonth);
    if (d) curDate = d;
    if (!curDate) continue;
    const t = parseTime(row[col.time]?.v);
    const open = col.method >= 0 && fold(text(row[col.method]?.v)).includes("CHUA KET THUC");
    if (!t && !open) continue;
    const pc = pairCol >= 0 ? row[pairCol] : undefined;
    const key = pc?.m ?? null;
    const shift = text(pc?.v).trim() || undefined;
    const last = groups[groups.length - 1];
    const same = last && last.date === curDate && !last.open && (key ? last.key === key : !last.key && last.times.length === 1);
    const g: Group = same ? last : { date: curDate, key, times: [], open: false, shift };
    if (!same) groups.push(g);
    if (t) g.times.push(t);
    if (open) g.open = true;
    if (!g.shift && shift) g.shift = shift;
  }
  for (const g of groups) {
    if (!g.times.length) continue;
    const s: ImportSession = { date: g.date, inTime: g.times[0], outTime: !g.open && g.times.length > 1 ? g.times[g.times.length - 1] : null, ...(g.shift ? { shift: g.shift } : {}) };
    const w = warnOf(s);
    if (w) s.warn = w;
    out.sessions.push(s);
  }
  if (!out.sessions.length) out.warnings.push("Không có lượt chấm công nào");
  return out;
}

/** Gợi ý nhân viên theo tên (bỏ dấu, khớp đủ / khớp tên cuối / chứa nhau). */
export function matchStaff<T extends { id: string; name: string }>(name: string, staff: T[]): T | null {
  const n = fold(name).replace(/\s+/g, " ");
  if (!n) return null;
  const f = staff.map((s) => ({ s, k: fold(s.name).replace(/\s+/g, " ") }));
  const exact = f.filter((x) => x.k === n);
  if (exact.length === 1) return exact[0].s;
  const contain = f.filter((x) => x.k && (x.k.includes(n) || n.includes(x.k)));
  if (contain.length === 1) return contain[0].s;
  // so từng từ: "Nga Le" ↔ "Lê Thị Nga"
  const words = new Set(n.split(" "));
  const scored = f
    .map((x) => ({ s: x.s, score: x.k.split(" ").filter((w) => words.has(w)).length }))
    .filter((x) => x.score >= Math.min(2, words.size))
    .sort((a, b) => b.score - a.score);
  if (scored.length && (scored.length === 1 || scored[0].score > scored[1].score)) return scored[0].s;
  return null;
}

/** Ca mẫu khớp theo tên ("Ca Sáng", "sang", "S"). */
export function matchTemplate<T extends { name: string }>(label: string | undefined, templates: T[]): T | null {
  if (!label) return null;
  const n = fold(label).replace(/^CA\s+/, "");
  if (!n) return null;
  return templates.find((t) => fold(t.name).replace(/^CA\s+/, "") === n) ?? templates.find((t) => fold(t.name).replace(/^CA\s+/, "").startsWith(n)) ?? null;
}

/** Sinh lượt chấm hộ cho nhiều ngày: theo ca (lấy giờ ca) hoặc giờ tự nhập. */
export function expandBulk(opts: { dates: string[]; shifts?: { name: string; startTime: string; endTime: string }[]; inTime?: string; outTime?: string }): ImportSession[] {
  const dates = [...new Set(opts.dates)].sort();
  const out: ImportSession[] = [];
  for (const date of dates) {
    if (opts.shifts?.length) {
      for (const s of [...opts.shifts].sort((a, b) => a.startTime.localeCompare(b.startTime))) out.push({ date, inTime: s.startTime.slice(0, 5), outTime: s.endTime.slice(0, 5), shift: s.name });
    } else if (opts.inTime) {
      const s: ImportSession = { date, inTime: opts.inTime.slice(0, 5), outTime: opts.outTime ? opts.outTime.slice(0, 5) : null };
      out.push(s);
    }
  }
  return out;
}

/** Kết quả AI đọc ảnh bảng chấm công → các lượt (có tên nhân viên nếu ảnh ghi). Thiếu giờ mà có ca → lấy giờ ca. */
export function normalizeAiAttendance(
  json: unknown,
  refMonth: string,
  templates: { name: string; startTime: string; endTime: string }[],
): (ImportSession & { name: string })[] {
  const recs = ((json as { records?: unknown[] })?.records ?? []) as Record<string, unknown>[];
  const out: (ImportSession & { name: string })[] = [];
  for (const r of recs) {
    const date = parseDate(r.date, refMonth);
    if (!date) continue;
    const tpl = matchTemplate(typeof r.shift === "string" ? r.shift : undefined, templates);
    const inTime = parseTime(r.check_in) ?? (tpl ? tpl.startTime.slice(0, 5) : null);
    if (!inTime) continue;
    const outRaw = parseTime(r.check_out);
    const outTime = outRaw ?? (tpl && !parseTime(r.check_in) ? tpl.endTime.slice(0, 5) : null);
    const s: ImportSession & { name: string } = {
      name: String(r.employee_name ?? "").trim(),
      date,
      inTime,
      outTime,
      ...(tpl ? { shift: tpl.name } : typeof r.shift === "string" && r.shift.trim() ? { shift: r.shift.trim() } : {}),
    };
    const w = warnOf(s);
    if (w) s.warn = w;
    out.push(s);
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.date.localeCompare(b.date) || a.inTime.localeCompare(b.inTime));
  return out;
}
