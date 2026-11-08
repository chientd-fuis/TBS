/* Tài chính: doanh thu – chi phí – lợi nhuận. File thuần (không DB) để dễ test. */
import { parseMoney, parseOcrDate } from "./revenue";

/** Mục chi phí admin nhập: Nguyên liệu · Điện nước · Khác (+ Lương NV: chỉ lưu chứng từ, mặc định không tính). */
export const EXPENSE_CATEGORIES = [
  { key: "NGUYEN_LIEU", label: "Nguyên liệu" },
  { key: "DIEN_NUOC", label: "Điện nước" },
  { key: "KHAC", label: "Khác" },
  { key: "LUONG", label: "Lương / thưởng / tạm ứng NV" },
] as const;
/** Mục cũ (dữ liệu trước đây) – vẫn hợp lệ, hiển thị gộp vào "Khác". */
const LEGACY_CATEGORIES: Record<string, string> = {
  BAO_BI: "Bao bì, ly, ống hút",
  VAN_CHUYEN: "Vận chuyển, ship",
  MAT_BANG: "Mặt bằng",
  SUA_CHUA: "Sửa chữa, thiết bị",
  PHAN_MEM: "Phần mềm, internet",
  MARKETING: "Marketing",
};
/** Nhóm hiển thị trên báo cáo: NGUYEN_LIEU | DIEN_NUOC | LUONG | KHAC */
export const categoryGroup = (c?: string | null) => (c === "NGUYEN_LIEU" || c === "DIEN_NUOC" || c === "LUONG" ? c : "KHAC");
/** Danh mục chỉ lưu chứng từ, KHÔNG cộng vào chi phí (lương đã tính từ bảng lương / giờ công). */
export const EXCLUDED_CATEGORIES: readonly string[] = ["LUONG"];
/** Mặc định lương/thưởng KHÔNG tính (đã có bảng lương) – admin tick "Tính vào chi phí" để tính. */
export const defaultCountInCost = (category?: string | null) => !EXCLUDED_CATEGORIES.includes(category ?? "");
export const isCountedExpense = (e: { category?: string | null; paidFrom?: string | null; countInCost?: boolean | null }) =>
  e.paidFrom !== "CASHBOX" && (typeof e.countInCost === "boolean" ? e.countInCost : defaultCountInCost(e.category));
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const CATEGORY_LABEL: Record<string, string> = { ...LEGACY_CATEGORIES, ...Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.key, c.label])) };
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

/*
 * Mô hình lãi lỗ CHUỖI:
 *  - Mỗi cơ sở: Doanh thu thực thu (TM + TK + Grab + Shopee + tiền két đã chi) − phí sàn − chi phí trong ca (két)
 *    − lương NV − tiền thuê nhà (− bill gắn riêng cơ sở, nếu có) = LÃI GỘP CƠ SỞ (đóng góp cho chuỗi).
 *  - Chi phí admin nhập (sao kê / CK) = CHI PHÍ CHUNG của chuỗi, không chia cho cơ sở.
 *  - Lãi chuỗi = Σ lãi gộp cơ sở − chi phí chung.
 *  - Xem theo cơ sở (tuỳ chọn): phân bổ chi phí chung theo tỷ lệ doanh thu → lãi sau phân bổ (tham khảo).
 */
export type PnlLine = {
  revenue: number; // doanh thu thật = TK + TM + Grab + Shopee + chi phí két
  machine: number; // doanh thu máy (DTm) – tham khảo / đối chiếu âm dương
  tm: number; // chi tiết thực thu
  tk: number;
  grab: number;
  shopee: number;
  platformFee: number; // phí sàn Grab/Shopee
  cashbox: number; // chi phí trong ca (tiền két)
  direct: number; // bill gắn riêng 1 cơ sở (dữ liệu cũ)
  labor: number; // lương NV ước tính
  fixed: number; // tiền thuê nhà / ngày
  contribution: number; // lãi gộp cơ sở = revenue − chi phí cơ sở
  shared: number; // chi phí chung chuỗi (chỉ có ở cấp ngày / tổng)
  cost: number; // tổng chi phí
  profit: number; // cấp cơ sở = contribution; cấp ngày / tổng = lãi chuỗi
};
export const emptyLine = (): PnlLine => ({
  revenue: 0,
  machine: 0,
  tm: 0,
  tk: 0,
  grab: 0,
  shopee: 0,
  platformFee: 0,
  cashbox: 0,
  direct: 0,
  labor: 0,
  fixed: 0,
  contribution: 0,
  shared: 0,
  cost: 0,
  profit: 0,
});
/** chi phí phát sinh tại cơ sở */
// Doanh thu thật = TK + TM + Grab + Shopee + chi phí két (két = lấy tiền doanh thu ra chi) → két cũng là 1 khoản chi phí
export const STORE_COST_KEYS = ["platformFee", "cashbox", "labor", "fixed", "direct"] as const;
const COST_KEYS = [...STORE_COST_KEYS, "shared"] as const;
export const COST_LABEL: Record<(typeof COST_KEYS)[number], string> = {
  platformFee: "Phí sàn Grab/Shopee",
  cashbox: "Chi phí két (trong ca)",
  labor: "Lương NV",
  fixed: "Mặt bằng",
  direct: "Chi phí gắn riêng cơ sở",
  shared: "Chi phí (admin nhập)",
};
export { COST_KEYS };

function addLine(a: PnlLine, b: Partial<PnlLine>) {
  for (const k of Object.keys(b) as (keyof PnlLine)[]) a[k] += b[k] ?? 0;
}
function finish(l: PnlLine) {
  const storeCost = STORE_COST_KEYS.reduce((s, k) => s + l[k], 0);
  l.contribution = l.revenue - storeCost;
  l.cost = storeCost + l.shared;
  l.profit = l.revenue - l.cost;
  return l;
}
export const margin = (l: PnlLine) => (l.revenue > 0 ? l.profit / l.revenue : 0);
export const contributionMargin = (l: PnlLine) => (l.revenue > 0 ? l.contribution / l.revenue : 0);

export type PnlInput = {
  storeIds: string[];
  dates: string[]; // các ngày của kỳ (YYYY-MM-DD, tăng dần)
  revenue: { storeId: string; date: string; dt?: number | null; tm?: number; tk?: number; cp: number; grab: number; shopee: number }[];
  expenses: {
    date: string;
    amount: number;
    scope: string;
    storeId?: string | null;
    allocation?: string | null;
    customShares?: Share[] | null;
    paidFrom?: string | null;
    countInCost?: boolean | null;
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
};

export type PnlResult = {
  cells: Record<string, PnlLine>; // `${date}|${storeId}` – cấp cơ sở (không có chi phí chung)
  byStore: Record<string, PnlLine>; // lãi gộp từng cơ sở
  byDate: Record<string, PnlLine>; // cả chuỗi theo ngày (có chi phí chung)
  total: PnlLine; // cả chuỗi
  /** chi phí admin nhập theo nhóm: NGUYEN_LIEU | DIEN_NUOC | LUONG | KHAC (tổng = total.shared) */
  byCategory: Record<string, number>;
  /** tuỳ chọn xem theo cơ sở: phần chi phí chung chia theo tỷ lệ doanh thu kỳ */
  allocByStore: Record<string, number>;
};

/** Tính lãi lỗ chuỗi + lãi gộp từng cơ sở. */
export function computePnl(inp: PnlInput): PnlResult {
  const { storeIds, dates } = inp;
  const inStore = new Set(storeIds);
  const inDate = new Set(dates);
  const cells: Record<string, PnlLine> = {};
  const cell = (date: string, sid: string) => (cells[`${date}|${sid}`] ??= emptyLine());
  for (const d of dates) for (const s of storeIds) cell(d, s);
  const byCategory: Record<string, number> = {};
  const addCat = (c: string | undefined, n: number) => (byCategory[c || "KHAC"] = (byCategory[c || "KHAC"] ?? 0) + n);
  const common: Record<string, number> = {};
  const addCommon = (d: string, n: number) => (common[d] = (common[d] ?? 0) + n);

  for (const r of inp.revenue) {
    if (!inStore.has(r.storeId) || !inDate.has(r.date)) continue;
    const fee = inp.fees[r.storeId] ?? { grab: 0, shopee: 0 };
    const cp = r.cp || 0;
    addLine(cell(r.date, r.storeId), {
      revenue: (r.tm || 0) + (r.tk || 0) + (r.grab || 0) + (r.shopee || 0) + cp, // DOANH THU THẬT = TK + TM + Grab + Shopee + chi phí két
      machine: r.dt || 0,
      tm: r.tm || 0,
      tk: r.tk || 0,
      grab: r.grab || 0,
      shopee: r.shopee || 0,
      cashbox: cp,
      platformFee: Math.round(((r.grab || 0) * (fee.grab || 0) + (r.shopee || 0) * (fee.shopee || 0)) / 100),
    });
  }

  for (const e of inp.expenses) {
    // tiền két đã tính trong "Thu chi" chốt ca; khoản bỏ tick "tính vào chi phí" (VD lương) → không cộng
    if (!inDate.has(e.date) || !isCountedExpense(e)) continue;
    if (e.scope === "STORE" && e.storeId && inStore.has(String(e.storeId))) addLine(cell(e.date, String(e.storeId)), { direct: e.amount });
    else {
      addCommon(e.date, e.amount);
      addCat(categoryGroup(e.category), e.amount); // gộp: Nguyên liệu / Điện nước / Lương / Khác
    }
  }

  for (const f of inp.fixed) {
    for (const d of dates) {
      const m = d.slice(0, 7);
      if (m < f.startMonth || (f.endMonth && m > f.endMonth)) continue;
      const perDay = Math.round(f.amountPerMonth / daysInMonth(m));
      if (f.scope === "STORE" && f.storeId && inStore.has(String(f.storeId))) addLine(cell(d, String(f.storeId)), { fixed: perDay });
      else {
        addCommon(d, perDay);
        addCat("KHAC", perDay);
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
  }
  for (const d of dates) {
    byDate[d].shared = common[d] ?? 0;
    finish(byDate[d]);
    addLine(total, byDate[d]);
  }
  for (const s of storeIds) finish(byStore[s]);
  finish(total);
  // tuỳ chọn: chia chi phí chung cho cơ sở theo tỷ lệ doanh thu của kỳ
  const rev = Object.fromEntries(storeIds.map((s) => [s, byStore[s].revenue]));
  const allocByStore = allocate(total.shared, shareMap(storeIds, "REVENUE", rev));
  return { cells, byStore, byDate, total, byCategory, allocByStore };
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
  countInCost?: boolean | null;
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
    e.storeName ? `🏪 Gắn riêng cơ sở: ${e.storeName.replace(/^TBS\s*/i, "")}` : "🏪 Chi phí chung chuỗi",
  ];
  if (e.vendor) lines.push(`🛒 Nơi bán: ${e.vendor}`);
  if (e.items) lines.push(`📝 Nội dung: ${e.items}`);
  lines.push(`💳 Nguồn tiền: ${e.paidFrom === "CASHBOX" ? "Tiền két (đã trừ trong thu chi ca)" : "Chủ trả / chuyển khoản"}`);
  if (e.transferNote) lines.push(`🏦 Nội dung CK: ${e.transferNote}`);
  if (e.note) lines.push(`🗒 Ghi chú: ${e.note}`);
  if (!isCountedExpense(e)) lines.push("ℹ️ Chỉ lưu chứng từ – không tính vào chi phí");
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
export function detectSalary(
  b: { vendor?: string | null; transferNote?: string | null; items?: string | null },
  staffNames: string[],
): { text: string; strong: boolean } | null {
  // nội dung CK ghi rõ "lương / tạm ứng / thưởng…" → chắc chắn là lương
  const m = SALARY_WORDS.exec(foldVi(`${b.transferNote ?? ""} ${b.items ?? ""}`));
  if (m) return { text: `Nội dung có "${m[1].toLowerCase()}"`, strong: true };
  // chỉ trùng tên người nhận → có thể là hoàn tiền mua hàng… → chỉ gợi ý, không tự đổi mục
  const who = foldVi(b.vendor ?? "");
  if (who.split(" ").length >= 2)
    for (const n of staffNames) {
      const f = foldVi(n);
      if (f.split(" ").length >= 2 && (who === f || who.endsWith(" " + f) || f.endsWith(" " + who) || who.includes(f)))
        return { text: `Người nhận "${b.vendor}" trùng tên nhân viên ${n}`, strong: false };
    }
  return null;
}

/* ---------- Sao kê / biên lai chuyển khoản: nhiều giao dịch ---------- */
export type StatementTx = {
  date?: string;
  time?: string; // HH:mm
  amount: number;
  recipient?: string;
  transferNote?: string;
  purpose?: string; // chi cho việc gì
  category?: ExpenseCategory;
  salaryHint?: string;
};

/** Chuẩn hoá JSON Gemini { transactions: [...] } → chỉ giữ giao dịch TIỀN RA có số tiền. */
export function normalizeStatement(raw: unknown, refDate?: string): StatementTx[] {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.transactions) ? o.transactions : Array.isArray(raw) ? (raw as unknown[]) : [];
  const txt = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);
  const out: StatementTx[] = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const t = it as Record<string, unknown>;
    const dir = String(t.direction ?? "OUT").toUpperCase();
    let amount = parseMoney(t.amount);
    if (amount === null || amount === 0) continue;
    if (dir === "IN" || (dir !== "OUT" && amount > 0 && /^\+/.test(String(t.amount)))) continue; // tiền vào → bỏ
    amount = Math.abs(amount);
    const tx: StatementTx = { amount };
    const d = t.date != null && String(t.date).trim() ? parseOcrDate(String(t.date), refDate) : null;
    if (d) tx.date = d;
    const tm = /^(\d{1,2}):(\d{2})/.exec(String(t.time ?? ""));
    if (tm) tx.time = `${tm[1].padStart(2, "0")}:${tm[2]}`;
    tx.recipient = txt(t.recipient ?? t.vendor, 120);
    tx.transferNote = txt(t.transfer_note ?? t.transferNote ?? t.note, 200);
    tx.purpose = txt(t.purpose ?? t.items, 300);
    if (isCategory(t.category)) tx.category = t.category;
    for (const k of Object.keys(tx) as (keyof StatementTx)[]) if (tx[k] === undefined) delete tx[k];
    out.push(tx);
  }
  return out;
}

/** Khoá để bỏ giao dịch lặp khi nhiều ảnh sao kê chụp chồng lên nhau. */
export const txKey = (t: { date?: string; time?: string; amount: number; transferNote?: string }) =>
  `${t.date ?? ""}|${t.time ?? ""}|${t.amount}|${foldVi(t.transferNote ?? "").slice(0, 40)}`;

/** Tin Telegram cho 1 lần nhập nhiều khoản chi. */
export function formatExpenseBatchCaption(
  rows: { date: string; amount: number; category: string; target: string; content?: string | null; countInCost: boolean }[],
  by: string,
) {
  const total = rows.filter((r) => r.countInCost).reduce((s, r) => s + r.amount, 0);
  const skipped = rows.filter((r) => !r.countInCost);
  const lines = [`💸 CHI PHÍ – ${rows.length} khoản · tính vào chi phí ${total.toLocaleString("vi-VN")} đ`];
  rows.forEach((r, i) => {
    const [, m, d] = r.date.split("-");
    lines.push(
      `${i + 1}. ${d}/${m} · ${r.amount.toLocaleString("vi-VN")} · ${CATEGORY_LABEL[r.category] ?? r.category}${r.target ? ` · ${r.target}` : ""}${r.content ? ` – ${r.content}` : ""}${r.countInCost ? "" : " (không tính chi phí)"}`,
    );
  });
  if (skipped.length) lines.push(`ℹ️ ${skipped.length} khoản chỉ lưu chứng từ, không tính vào chi phí`);
  lines.push(`👤 Người nhập: ${by}`);
  return lines.join("\n");
}
