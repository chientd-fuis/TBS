/* Doanh thu chốt ca – hàm thuần (có unit test): đọc số tiền, chuẩn hoá kết quả đọc ảnh, cộng theo ngày, vị trí ô trên Google Sheet. */

export const REVENUE_KEYS = ["dt", "tm", "tk", "cp", "grab", "shopee"] as const;
export type RevenueKey = (typeof REVENUE_KEYS)[number];
export type Revenue = Record<RevenueKey, number>;

export const REVENUE_LABEL: Record<RevenueKey, string> = {
  dt: "Doanh thu máy",
  tm: "Tiền mặt",
  tk: "Tài khoản",
  cp: "Thu chi",
  grab: "Grab",
  shopee: "Shopee",
};

export const emptyRevenue = (): Revenue => ({ dt: 0, tm: 0, tk: 0, cp: 0, grab: 0, shopee: 0 });

/**
 * Tính biểu thức tiền nhân viên gõ: "10000 +20000 + 20k" → 50000, "30k sữa chua + 20k ship" → 50000,
 * "1tr2 - 50k" → 1150000. Mỗi khoản bỏ chữ mô tả, lấy số tiền (lớn nhất nếu có nhiều số). Trống → 0.
 * ok = false nếu có khoản không có số.
 */
export function evalMoneyExpr(input: string): { value: number; ok: boolean; items: number } {
  const s = (input ?? "").trim();
  if (!s) return { value: 0, ok: true, items: 0 };
  // tách theo dấu + / − (giữ dấu); dấu "-" dính liền chữ (VD "sữa-chua") vẫn coi là dấu trừ – hiếm gặp
  const parts = s.split(/(?=[+\-−])/);
  let value = 0;
  let items = 0;
  let ok = true;
  for (const raw of parts) {
    let t = raw.trim();
    if (!t) continue;
    let sign = 1;
    if (/^[+\-−]/.test(t)) {
      sign = t[0] === "+" ? 1 : -1;
      t = t.slice(1).trim();
    }
    if (!t) continue;
    // khoản có thể kèm số lượng ("2 ly trà 30k") → lấy số tiền lớn nhất trong khoản
    const nums = [...t.matchAll(/\d[\d.,]*\s*(?:tr\d{0,3}|k|nghìn|ngàn|đ|vnd)?/gi)]
      .map((m) => parseMoney(m[0].replace(/\s+/g, "").replace(/nghìn|ngàn/i, "k").replace(/[.,]$/, "")))
      .filter((x): x is number => x != null);
    const n = nums.length ? Math.max(...nums) : null;
    if (n == null) {
      ok = false;
      continue;
    }
    value += sign * n;
    items++;
  }
  return { value, ok, items };
}

/**
 * Tách biểu thức thành từng khoản có mô tả: "30k sữa chua + 20k ship - 5k" →
 * [{amount: 30000, label: "sữa chua"}, {amount: 20000, label: "ship"}, {amount: -5000, label: ""}].
 */
export function moneyExprItems(input: string): { amount: number; label: string }[] {
  const s = (input ?? "").trim();
  if (!s) return [];
  const out: { amount: number; label: string }[] = [];
  for (const raw of s.split(/(?=[+\-−])/)) {
    let t = raw.trim();
    let sign = 1;
    if (/^[+\-−]/.test(t)) {
      sign = t[0] === "+" ? 1 : -1;
      t = t.slice(1).trim();
    }
    if (!t) continue;
    const re = /\d[\d.,]*\s*(?:tr\d{0,3}|k|nghìn|ngàn|đ|vnd)?/gi;
    const nums = [...t.matchAll(re)]
      .map((m) => parseMoney(m[0].replace(/\s+/g, "").replace(/nghìn|ngàn/i, "k").replace(/[.,]$/, "")))
      .filter((x): x is number => x != null);
    if (!nums.length) continue;
    const label = t.replace(re, " ").replace(/\s+/g, " ").replace(/^[\s:,;.-]+|[\s:,;.-]+$/g, "").trim();
    out.push({ amount: sign * Math.max(...nums), label });
  }
  return out;
}

/** "7.060.000 đ" / "7,060,000" / "7tr06" / 7060000 → 7060000. Không đọc được → null. */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase().replace(/\s|đ|vnd|vnđ|₫/g, "");
  if (!s) return null;
  const neg = s.startsWith("-");
  s = s.replace(/^[-+]/, "");
  // 7tr06 / 7tr / 7.5tr / 850k
  const tr = /^(\d+(?:[.,]\d+)?)tr(\d{0,3})$/.exec(s);
  if (tr) {
    const base = Number(tr[1].replace(",", ".")) * 1_000_000;
    const extra = tr[2] ? Number(tr[2].padEnd(3, "0")) * 1_000 : 0;
    return (neg ? -1 : 1) * Math.round(base + extra);
  }
  const k = /^(\d+(?:[.,]\d+)?)k$/.exec(s);
  if (k) return (neg ? -1 : 1) * Math.round(Number(k[1].replace(",", ".")) * 1000);
  // dấu chấm/phẩy phân tách hàng nghìn (kiểu VN hoặc kiểu Mỹ)
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return (neg ? -1 : 1) * Number(s.replace(/[.,]/g, ""));
  if (/^\d+$/.test(s)) return (neg ? -1 : 1) * Number(s);
  return null;
}

/** Tên trường mà bot đọc ảnh có thể trả về → khoá chuẩn. */
const ALIASES: Record<RevenueKey, string[]> = {
  dt: ["dt", "doanhthu", "doanh_thu", "revenue", "total", "tong", "tongdoanhthu"],
  tk: ["tk", "taikhoan", "tai_khoan", "chuyenkhoan", "chuyen_khoan", "bank", "transfer", "ck"],
  tm: ["tm", "tienmat", "tien_mat", "cash"],
  cp: ["cp", "chiphi", "chi_phi", "cptrongket", "cp_trong_ket", "expense", "expenses", "thuchi", "thu_chi"],
  grab: ["grab", "grabfood", "grab_food"],
  shopee: ["shopee", "shopeefood", "shopee_food", "spf"],
};
const norm = (k: string) =>
  k
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");

/**
 * Chuẩn hoá JSON bot trả về (chấp nhận { dt, tk, … } hoặc { revenue: {...} } / { data: {...} },
 * tên trường tiếng Việt có/không dấu, số dạng chuỗi). Trường không có → không đưa vào kết quả.
 */
export function normalizeOcr(raw: unknown, refDate?: string): { values: Partial<Revenue>; note?: string; date?: string; cpDetail?: string } {
  let obj = raw as Record<string, unknown> | null;
  if (obj && typeof obj === "object") {
    for (const wrap of ["revenue", "data", "result", "values"])
      if (obj[wrap] && typeof obj[wrap] === "object") {
        obj = { ...obj, ...(obj[wrap] as Record<string, unknown>) };
      }
  }
  const values: Partial<Revenue> = {};
  let note: string | undefined;
  let date: string | undefined;
  let cpDetail: string | undefined;
  if (!obj || typeof obj !== "object") return { values };
  for (const [k, v] of Object.entries(obj)) {
    const nk = norm(k);
    if (["note", "ghichu", "ghi_chu", "notes"].includes(nk) && typeof v === "string" && v.trim()) note = v.trim();
    if (["date", "ngay", "ngay_chot", "ngaychot"].includes(nk) && v != null) date = parseOcrDate(String(v), refDate) ?? undefined;
    if (["cp_detail", "cpdetail", "thu_chi_chi_tiet", "thuchichitiet", "chi_tiet_thu_chi", "expense_detail"].includes(nk) && typeof v === "string" && v.trim())
      cpDetail = v.trim();
    for (const key of REVENUE_KEYS)
      if (ALIASES[key].includes(nk) && values[key] === undefined) {
        const n = parseMoney(v);
        if (n !== null) values[key] = n;
      }
  }
  return { values, note, date, cpDetail };
}

/**
 * Ngày đọc từ ảnh → YYYY-MM-DD. Nhận "07/11/2026", "7/11/26", "07-11", "2026-11-07".
 * Thiếu năm → lấy năm của refDate (YYYY-MM-DD). Không hợp lệ → null.
 */
export function parseOcrDate(s: string, refDate?: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/.exec(t))) {
    d = Number(r[1]);
    m = Number(r[2]);
    y = r[3] ? Number(r[3].length === 2 ? `20${r[3]}` : r[3]) : Number((refDate ?? new Date().toISOString()).slice(0, 4));
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso + "T00:00:00Z")) ? null : iso;
}

/** Âm/Dương (chênh lệch) = Doanh thu máy − (Tiền mặt + Tài khoản + Thu chi + Grab + Shopee). */
export function revenueDiff(r: Partial<Revenue>) {
  const n = (k: RevenueKey) => Number(r[k] ?? 0) || 0;
  return n("dt") - (n("tm") + n("tk") + n("cp") + n("grab") + n("shopee"));
}

export function sumRevenue(list: Partial<Revenue>[]): Revenue {
  const out = emptyRevenue();
  for (const r of list) for (const k of REVENUE_KEYS) out[k] += Number(r[k] ?? 0) || 0;
  return out;
}

/** Tên tab theo tháng: mẫu {m} {mm} {yyyy} {yy}. VD "T{m}" + 2026-11 → "T11". */
export function sheetTabName(pattern: string, month: string) {
  const [y, m] = month.split("-");
  return (pattern || "T{m}")
    .replace(/\{yyyy\}/g, y)
    .replace(/\{yy\}/g, y.slice(2))
    .replace(/\{mm\}/g, m)
    .replace(/\{m\}/g, String(Number(m)));
}

/** Dòng của ngày d (ngày 1 ở dòng firstRow). */
export function sheetRowOf(date: string, firstRow = 3) {
  return firstRow + Number(date.slice(8, 10)) - 1;
}

/** Lấy ID từ link Google Sheet (hoặc trả nguyên nếu đã là ID). */
export function extractSheetId(input: string) {
  const s = input.trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : "";
}

export const vndShort = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} đ`;

/* ---------- Ca chốt (ca thu ngân) – khác ca xếp lịch ---------- */
export const CLOSING_SHIFTS = [
  { key: "S", name: "Sáng", start: "08:00", end: "16:00" },
  { key: "C", name: "Chiều", start: "16:00", end: "20:00" },
  { key: "T", name: "Tối", start: "20:00", end: "08:00" }, // qua đêm – ca cuối ngày, ghi Google Sheet
] as const;
export type ClosingShiftKey = (typeof CLOSING_SHIFTS)[number]["key"];

/** Ca chốt mặc định theo giờ hiện tại (giờ địa phương 0–23): 8h–16h Sáng, 16h–20h Chiều, 20h–8h Tối. */
export function defaultClosingShift(hour: number): ClosingShiftKey {
  if (hour >= 8 && hour < 16) return "S";
  if (hour >= 16 && hour < 20) return "C";
  return "T";
}

/** Ngày doanh thu của lượt chốt: ca Tối chốt sau nửa đêm (trước 8h) tính cho NGÀY HÔM TRƯỚC. */
export function closingWorkDate(key: ClosingShiftKey, today: string, hour: number, addDaysFn: (d: string, n: number) => string) {
  return key === "T" && hour < 8 ? addDaysFn(today, -1) : today;
}

/* ---------- Mẫu cột Google Sheet theo cơ sở ---------- */
/**
 * GRAB_COL (mặc định cơ sở mới, Geleximco): B DT · C TK · D TM · E CP · F Shopee · G Grab · (H, I công thức) · J Ghi chú
 * LEGACY  (Văn Phú, Đô Nghĩa – mẫu cũ):      B DT · C TK · D TM · E CP · F Shopee (+ Grab) · (G, H công thức) · I Ghi chú
 */
export type SheetLayout = "GRAB_COL" | "LEGACY";
export const SHEET_LAYOUTS: { value: SheetLayout; label: string }[] = [
  { value: "GRAB_COL", label: "Có cột Grab (B–G, ghi chú J)" },
  { value: "LEGACY", label: "Mẫu cũ (B–F, Grab gộp Shopee, ghi chú I)" },
];

/** Cơ sở chưa chọn mẫu (dữ liệu cũ): Geleximco dùng mẫu có cột Grab, các cơ sở cũ khác dùng mẫu cũ. */
export function sheetLayoutOf(store: { revenueSheetLayout?: string | null; name?: string | null }): SheetLayout {
  if (store.revenueSheetLayout === "GRAB_COL" || store.revenueSheetLayout === "LEGACY") return store.revenueSheetLayout;
  return /geleximco/i.test(store.name ?? "") ? "GRAB_COL" : "LEGACY";
}

/** Các ô cần ghi cho 1 ngày theo mẫu cột. Trả về [{col range (không gồm tab), values}]. */
export function sheetRowCells(layout: SheetLayout, row: number, r: Revenue, note: string) {
  if (layout === "LEGACY") {
    const n = [r.grab ? `Shopee ${r.shopee.toLocaleString("vi-VN")} + Grab ${r.grab.toLocaleString("vi-VN")}` : "", note].filter(Boolean).join(" | ");
    return [
      { range: `B${row}:F${row}`, values: [[r.dt, r.tk, r.tm, r.cp, r.shopee + r.grab]] },
      { range: `I${row}`, values: [[n]] },
    ];
  }
  return [
    { range: `B${row}:G${row}`, values: [[r.dt, r.tk, r.tm, r.cp, r.shopee, r.grab]] },
    { range: `J${row}`, values: [[note]] },
  ];
}
