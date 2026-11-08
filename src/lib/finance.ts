/* Tài chính: doanh thu – chi phí – lợi nhuận. File thuần (không DB) để dễ test. */
import { parseMoney, parseOcrDate } from "./revenue";

export const EXPENSE_CATEGORIES = [
  { key: "NGUYEN_LIEU", label: "Nguyên liệu" },
  { key: "BAO_BI", label: "Bao bì, ly, ống hút" },
  { key: "VAN_CHUYEN", label: "Vận chuyển, ship" },
  { key: "DIEN_NUOC", label: "Điện, nước, gas" },
  { key: "MAT_BANG", label: "Mặt bằng" },
  { key: "SUA_CHUA", label: "Sửa chữa, thiết bị" },
  { key: "PHAN_MEM", label: "Phần mềm, internet" },
  { key: "MARKETING", label: "Marketing" },
  { key: "KHAC", label: "Khác" },
  { key: "LUONG", label: "Lương / thưởng / tạm ứng NV (không tính)" },
] as const;
/** Danh mục chỉ lưu chứng từ, KHÔNG cộng vào chi phí (lương đã tính từ bảng lương / giờ công). */
export const EXCLUDED_CATEGORIES: readonly string[] = ["LUONG"];
export const isCountedExpense = (e: { category?: string | null; paidFrom?: string | null }) =>
  e.paidFrom !== "CASHBOX" && !EXCLUDED_CATEGORIES.includes(e.category ?? "");
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label]));
export const isCategory = (v: unknown): v is ExpenseCategory => typeof v === "string" && v in CATEGORY_LABEL;

export const ALLOCATIONS = [
  { key: "REVENUE", label: "Theo tỷ lệ doanh thu" },
  { key: "EQUAL", label: "Chia đều" },
  { key: "CUSTOM", label: "Tỷ lệ tự đặt" },
] as const;
export type Allocation = (typeof ALLOCATIONS)[number]["key"];
export const ALLOCATION_LABEL: Record<string, string> = Object.fromEntries(ALLOCATIONS.map((c) => [c.key, c.label]));

export type Share = { storeId: string; pct: number };

/**
 * Tỷ lệ chia chi phí chung cho các cơ sở (tổng = 1).
 * REVENUE: theo doanh thu kỳ (không có doanh thu → chia đều) · EQUAL · CUSTOM: % tự đặt (chuẩn hoá về tổng 1).
 */
export function shareMap(storeIds: string[], mode: string, revenueByStore: Record<string, number>, custom?: Share[] | null): Record<string, number> {
  const ids = [...storeIds];
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  let weights: number[] = ids.map(() => 1);
  if (mode === "REVENUE") {
    const w = ids.map((id) => Math.max(0, revenueByStore[id] ?? 0));
    if (w.some((x) => x > 0)) weights = w;
  } else if (mode === "CUSTOM" && custom?.length) {
    const w = ids.map((id) => Math.max(0, custom.find((c) => String(c.storeId) === id)?.pct ?? 0));
    if (w.some((x) => x > 0)) weights = w;
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  ids.forEach((id, i) => (out[id] = weights[i] / sum));
  return out;
}

/** Chia số tiền theo tỷ lệ, làm tròn đồng, phần lẻ dồn vào cơ sở có tỷ lệ lớn nhất → tổng khớp đúng. */
export function allocate(amount: number, shares: Record<string, number>): Record<string, number> {
  const ids = Object.keys(shares);
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  let used = 0;
  for (const id of ids) used += out[id] = Math.round(amount * shares[id]);
  const big = ids.reduce((a, b) => (shares[b] > shares[a] ? b : a));
  out[big] += amount - used;
  return out;
}

export const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

export type PnlLine = {
  revenue: number; // doanh thu máy
  platformFee: number; // phí sàn Grab/Shopee
  cashbox: number; // thu chi trong ca (tiền két)
  direct: number; // bill riêng của cơ sở
  shared: number; // phần chia từ bill chung
  labor: number; // lương ước tính
  fixed: number; // chi phí cố định / ngày
  cost: number; // tổng chi phí
  profit: number;
};
export const emptyLine = (): PnlLine => ({ revenue: 0, platformFee: 0, cashbox: 0, direct: 0, shared: 0, labor: 0, fixed: 0, cost: 0, profit: 0 });
const COST_KEYS = ["platformFee", "cashbox", "direct", "shared", "labor", "fixed"] as const;
export const COST_LABEL: Record<(typeof COST_KEYS)[number], string> = {
  platformFee: "Phí sàn Grab/Shopee",
  cashbox: "Chi phí trong ca (két)",
  direct: "Bill / CK – riêng cơ sở",
  shared: "Bill / CK – chung (phân bổ)",
  labor: "Lương (ước tính)",
  fixed: "Chi phí cố định",
};
export { COST_KEYS };

function addLine(a: PnlLine, b: Partial<PnlLine>) {
  for (const k of Object.keys(b) as (keyof PnlLine)[]) a[k] += b[k] ?? 0;
}
function finish(l: PnlLine) {
  l.cost = COST_KEYS.reduce((s, k) => s + l[k], 0);
  l.profit = l.revenue - l.cost;
  return l;
}
export const margin = (l: PnlLine) => (l.revenue > 0 ? l.profit / l.revenue : 0);

export type PnlInput = {
  storeIds: string[];
  dates: string[]; // các ngày của kỳ (YYYY-MM-DD, tăng dần)
  revenue: { storeId: string; date: string; dt: number; cp: number; grab: number; shopee: number }[];
  expenses: {
    date: string;
    amount: number;
    scope: string;
    storeId?: string | null;
    allocation?: string | null;
    customShares?: Share[] | null;
    paidFrom?: string | null;
    category?: string;
  }[];
  fixed: {
    amountPerMonth: number;
    scope: string;
    storeId?: string | null;
    allocation?: string | null;
    customShares?: Share[] | null;
    startMonth: string;
    endMonth?: string | null;
    category?: string;
  }[];
  labor: { storeId: string; date: string; amount: number }[];
  fees: Record<string, { grab: number; shopee: number }>; // % phí sàn theo cơ sở
  /** doanh thu dùng để tính tỷ lệ chia chi phí chung (mặc định = doanh thu của kỳ) */
  shareRevenue?: Record<string, number>;
};

export type PnlResult = {
  cells: Record<string, PnlLine>; // `${date}|${storeId}`
  byStore: Record<string, PnlLine>;
  byDate: Record<string, PnlLine>;
  total: PnlLine;
  /** chi phí (bill + cố định, không gồm tiền két/lương/phí sàn) theo danh mục, theo cơ sở */
  byCategory: Record<string, number>;
};

/** Tính lãi lỗ từng cơ sở × từng ngày. */
export function computePnl(inp: PnlInput): PnlResult {
  const { storeIds, dates } = inp;
  const inStore = new Set(storeIds);
  const inDate = new Set(dates);
  const cells: Record<string, PnlLine> = {};
  const cell = (date: string, sid: string) => (cells[`${date}|${sid}`] ??= emptyLine());
  for (const d of dates) for (const s of storeIds) cell(d, s);
  const byCategory: Record<string, number> = {};
  const addCat = (c: string | undefined, n: number) => (byCategory[c || "KHAC"] = (byCategory[c || "KHAC"] ?? 0) + n);

  const periodRev: Record<string, number> = {};
  for (const r of inp.revenue) {
    if (!inStore.has(r.storeId) || !inDate.has(r.date)) continue;
    periodRev[r.storeId] = (periodRev[r.storeId] ?? 0) + (r.dt || 0);
    const fee = inp.fees[r.storeId] ?? { grab: 0, shopee: 0 };
    addLine(cell(r.date, r.storeId), {
      revenue: r.dt || 0,
      cashbox: r.cp || 0,
      platformFee: Math.round(((r.grab || 0) * (fee.grab || 0) + (r.shopee || 0) * (fee.shopee || 0)) / 100),
    });
  }
  const shareRev = inp.shareRevenue ?? periodRev;

  for (const e of inp.expenses) {
    // tiền két đã tính trong "Thu chi" chốt ca; lương NV đã tính từ giờ công → không cộng lại
    if (!inDate.has(e.date) || !isCountedExpense(e)) continue;
    if (e.scope === "STORE") {
      if (!e.storeId || !inStore.has(String(e.storeId))) continue;
      addLine(cell(e.date, String(e.storeId)), { direct: e.amount });
      addCat(e.category, e.amount);
    } else {
      const parts = allocate(e.amount, shareMap(storeIds, e.allocation || "REVENUE", shareRev, e.customShares));
      for (const [sid, n] of Object.entries(parts)) addLine(cell(e.date, sid), { shared: n });
      addCat(e.category, e.amount);
    }
  }

  for (const f of inp.fixed) {
    for (const d of dates) {
      const m = d.slice(0, 7);
      if (m < f.startMonth || (f.endMonth && m > f.endMonth)) continue;
      const perDay = Math.round(f.amountPerMonth / daysInMonth(m));
      if (f.scope === "STORE") {
        if (!f.storeId || !inStore.has(String(f.storeId))) continue;
        addLine(cell(d, String(f.storeId)), { fixed: perDay });
        addCat(f.category, perDay);
      } else {
        const parts = allocate(perDay, shareMap(storeIds, f.allocation || "REVENUE", shareRev, f.customShares));
        for (const [sid, n] of Object.entries(parts)) addLine(cell(d, sid), { fixed: n });
        addCat(f.category, perDay);
      }
    }
  }

  for (const l of inp.labor) if (inStore.has(l.storeId) && inDate.has(l.date)) addLine(cell(l.date, l.storeId), { labor: Math.round(l.amount) });

  const byStore: Record<string, PnlLine> = Object.fromEntries(storeIds.map((s) => [s, emptyLine()]));
  const byDate: Record<string, PnlLine> = Object.fromEntries(dates.map((d) => [d, emptyLine()]));
  const total = emptyLine();
  for (const [k, l] of Object.entries(cells)) {
    finish(l);
    const [d, s] = k.split("|");
    addLine(byStore[s], l);
    addLine(byDate[d], l);
    addLine(total, l);
  }
  // cost/profit đã cộng dồn đúng từ các ô (cộng tuyến tính) – không cần finish lại
  return { cells, byStore, byDate, total, byCategory };
}

/* ---------- Đọc bill chi phí (Gemini) ---------- */
export type BillOcr = {
  kind?: "BILL" | "TRANSFER";
  amount?: number;
  date?: string;
  vendor?: string; // nơi bán / người nhận tiền
  items?: string; // chi cho cái gì
  transferNote?: string; // nội dung chuyển khoản (nguyên văn)
  category?: ExpenseCategory;
  /** gợi ý: đây là trả lương / tạm ứng cho nhân viên */
  salaryHint?: string;
};

export function normalizeBill(raw: unknown, refDate?: string): BillOcr {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: BillOcr = {};
  const amt = parseMoney(o.amount ?? o.total ?? o.tong_tien);
  if (amt !== null && amt > 0) out.amount = amt;
  const d = o.date ?? o.ngay;
  if (d != null && String(d).trim()) out.date = parseOcrDate(String(d), refDate) ?? undefined;
  const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  out.vendor = txt(o.vendor ?? o.store ?? o.noi_ban, 120);
  out.items = txt(o.items ?? o.purpose ?? o.noi_dung ?? o.description, 300);
  out.transferNote = txt(o.transfer_note ?? o.transferNote ?? o.noi_dung_ck, 200);
  if (o.kind === "TRANSFER" || o.kind === "BILL") out.kind = o.kind;
  if (isCategory(o.category)) out.category = o.category;
  for (const k of Object.keys(out) as (keyof BillOcr)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/* ---------- Bất thường doanh thu ---------- */
/** So doanh thu với trung bình cùng thứ các tuần trước: lệch quá ngưỡng → trả % lệch (âm = thấp hơn). */
export function revenueDeviation(today: number, history: number[], threshold = 0.3): number | null {
  const h = history.filter((x) => x > 0);
  if (h.length < 2 || today <= 0) return null;
  const avg = h.reduce((a, b) => a + b, 0) / h.length;
  const dev = (today - avg) / avg;
  return Math.abs(dev) >= threshold ? dev : null;
}

/* ---------- Caption Telegram cho chi phí ---------- */
export type ExpenseCaption = {
  date: string;
  weekday: string; // "Thứ 5"
  amount: number;
  category: string;
  storeName?: string | null; // scope STORE
  allocation?: string | null; // scope SHARED
  vendor?: string | null;
  items?: string | null;
  transferNote?: string | null;
  note?: string | null;
  paidFrom?: string | null;
  by: string;
  edited?: boolean;
  deleted?: boolean;
};

export function formatExpenseCaption(e: ExpenseCaption) {
  const [y, m, d] = e.date.split("-");
  const lines = [
    e.deleted ? "🗑 ĐÃ XOÁ CHI PHÍ" : e.edited ? "💸 CHI PHÍ (SỬA)" : "💸 CHI PHÍ",
    `📅 Ngày: ${d}/${m}/${y} (${e.weekday})`,
    `💰 Số tiền: ${e.amount.toLocaleString("vi-VN")} đ`,
    `🏷 Danh mục: ${CATEGORY_LABEL[e.category] ?? e.category}`,
    `🏪 Cơ sở: ${e.storeName ? e.storeName.replace(/^TBS\s*/i, "") : `Chung – ${(ALLOCATION_LABEL[e.allocation ?? "REVENUE"] ?? "").toLowerCase()}`}`,
  ];
  if (e.vendor) lines.push(`🛒 Nơi bán: ${e.vendor}`);
  if (e.items) lines.push(`📝 Nội dung: ${e.items}`);
  lines.push(`💳 Nguồn tiền: ${e.paidFrom === "CASHBOX" ? "Tiền két (đã trừ trong thu chi ca)" : "Chủ trả / chuyển khoản"}`);
  if (e.transferNote) lines.push(`🏦 Nội dung CK: ${e.transferNote}`);
  if (e.note) lines.push(`🗒 Ghi chú: ${e.note}`);
  if (EXCLUDED_CATEGORIES.includes(e.category)) lines.push("ℹ️ Lương NV – chỉ lưu chứng từ, không cộng vào chi phí (đã có trong bảng lương)");
  lines.push(`👤 Người nhập: ${e.by}`);
  return lines.join("\n");
}

/* ---------- Nhận diện chuyển lương cho nhân viên ---------- */
export const foldVi = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const SALARY_WORDS = /\b(LUONG|TAM UNG|UNG LUONG|THUONG NV|THUONG NHAN VIEN|PHU CAP|SALARY)\b/;

/**
 * Bill / CK có phải trả lương nhân viên không: người nhận trùng họ tên NV (khớp đủ các chữ), hoặc nội dung có "lương / tạm ứng…".
 * Trả về lý do (để hiện cảnh báo) hoặc null.
 */
export function detectSalary(b: { vendor?: string | null; transferNote?: string | null; items?: string | null }, staffNames: string[]): string | null {
  const who = foldVi(b.vendor ?? "");
  if (who.split(" ").length >= 2)
    for (const n of staffNames) {
      const f = foldVi(n);
      if (f.split(" ").length >= 2 && (who === f || who.endsWith(" " + f) || f.endsWith(" " + who) || who.includes(f)))
        return `Người nhận "${b.vendor}" trùng tên nhân viên ${n}`;
    }
  const text = foldVi(`${b.transferNote ?? ""} ${b.items ?? ""}`);
  const m = SALARY_WORDS.exec(text);
  if (m) return `Nội dung có "${m[1].toLowerCase()}"`;
  return null;
}
