/*
 * Sổ quỹ = ước tính tiền đang có (dòng tiền hiện tại), cộng dồn từ trước đến nay – không theo tháng.
 *  Tài khoản = Σ doanh thu tài khoản − rút lãi (TK) − bill chuyển khoản + bổ sung vốn (TK) ± nộp / rút giữa TM và TK
 *  Tiền mặt  = Σ doanh thu tiền mặt  − đã rút (TM)                    + bổ sung vốn (TM) ± nộp / rút giữa TM và TK
 * Tiền mặt chốt ca đã trừ chi phí két (cp) nên không trừ lại; bill trả bằng tiền két (CASHBOX) cũng không trừ.
 */
export type CashAccount = "TK" | "TM";
/** TAKE = rút ra (rút lãi) · ADD = bổ sung vốn · DEPOSIT = nộp TM vào TK · WITHDRAW = rút TK ra TM */
export type CashKind = "TAKE" | "ADD" | "DEPOSIT" | "WITHDRAW";
export type CashMove = { kind: string; account?: string | null; amount: number };

export const CASH_KINDS = [
  { value: "TAKE_TK", kind: "TAKE", account: "TK", label: "Rút lãi từ tài khoản", short: "Rút lãi TK" },
  { value: "TAKE_TM", kind: "TAKE", account: "TM", label: "Rút tiền mặt", short: "Rút TM" },
  { value: "ADD_TK", kind: "ADD", account: "TK", label: "Bổ sung vốn vào tài khoản", short: "+ Vốn TK" },
  { value: "ADD_TM", kind: "ADD", account: "TM", label: "Bổ sung vốn tiền mặt", short: "+ Vốn TM" },
  { value: "DEPOSIT", kind: "DEPOSIT", account: null, label: "Nộp tiền mặt vào tài khoản", short: "TM → TK" },
  { value: "WITHDRAW", kind: "WITHDRAW", account: null, label: "Rút tài khoản ra tiền mặt", short: "TK → TM" },
] as const;
export const cashKindOf = (m: { kind: string; account?: string | null }) =>
  CASH_KINDS.find((k) => k.kind === m.kind && (k.account ?? null) === (m.kind === "TAKE" || m.kind === "ADD" ? (m.account ?? "TK") : null));

export type CashSide = { revenue: number; /** Grab + Shopee sau phí sàn (hãng chuyển về tài khoản) */ app: number; bills: number; payroll: number; take: number; add: number; transferIn: number; transferOut: number; balance: number };

/** Phiếu "Thanh toán lương" tự sinh từ bảng lương đã trả (trừ tài khoản) – không lưu riêng: mở khoá "Đã trả" là tự mất. */
export type PayEntry = { date: string; amount: number; note: string };

/**
 * Bảng lương → các lần trả lương:
 *  - Trả cả bảng (bấm "Đã trả tất cả" / trả đủ mọi người) → 1 phiếu "Thanh toán lương tháng 10/2026 · cơ sở" (gộp các dòng trả cùng ngày đó).
 *  - Trả lẻ từng người trước đó (VD nhân viên nghỉ việc giữa tháng) → "Thanh toán lương tháng 11/2026 cho nhân viên nghỉ việc Lan".
 */
export function payrollEntries(
  payrolls: { id: string; month: string; store: string; status: string; paidAt?: Date | null }[],
  items: { payrollId: string; netPay: number; paidAt?: Date | null; name: string; quit: boolean }[],
  dayOf: (d: Date) => string,
): PayEntry[] {
  const out: PayEntry[] = [];
  const mm = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
  for (const p of payrolls) {
    const paid = items.filter((i) => i.payrollId === p.id && i.paidAt && i.netPay > 0);
    const fullDay = p.status === "PAID" && p.paidAt ? dayOf(p.paidAt) : null;
    const group = fullDay ? paid.filter((i) => dayOf(i.paidAt!) === fullDay) : [];
    if (group.length) out.push({ date: fullDay!, amount: group.reduce((s, i) => s + i.netPay, 0), note: `Thanh toán lương tháng ${mm(p.month)} · ${p.store}` });
    for (const i of paid.filter((x) => !group.includes(x)))
      out.push({ date: dayOf(i.paidAt!), amount: i.netPay, note: `Thanh toán lương tháng ${mm(p.month)} cho ${i.quit ? "nhân viên nghỉ việc " : ""}${i.name} · ${p.store}` });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Doanh thu từng ngày sau phiếu nộp TM → TK / rút TK → TM (Admin Tổng ghi theo cơ sở + ngày):
 * nộp → TM ↓ TK ↑, rút → TK ↓ TM ↑. Đây là số tiền mặt thật còn lại của ngày đó.
 */
export function applyDayTransfers<R extends { storeId: string; date: string; tm: number; tk: number }>(
  rows: R[],
  transfers: { kind: string; amount: number; storeId?: unknown; date: string }[],
): R[] {
  const net = new Map<string, number>();
  for (const t of transfers) {
    if (!t.storeId || (t.kind !== "DEPOSIT" && t.kind !== "WITHDRAW")) continue;
    const k = `${String(t.storeId)}|${t.date}`;
    net.set(k, (net.get(k) ?? 0) + (t.kind === "DEPOSIT" ? t.amount : -t.amount));
  }
  return rows.map((r) => {
    const n = net.get(`${r.storeId}|${r.date}`) ?? 0;
    return n ? { ...r, tm: r.tm - n, tk: r.tk + n } : r;
  });
}

/**
 * Tiền mặt thực tế đang cầm = tiền mặt các ngày đã lấy & đếm − đã rút tiền mặt + bổ sung vốn tiền mặt được đánh dấu "đã lấy".
 */
export function actualCash(takenTm: number, moves: { kind: string; account?: string | null; amount: number; counted?: boolean | null }[]) {
  const tm = moves.filter((m) => m.account === "TM");
  const take = tm.filter((m) => m.kind === "TAKE").reduce((s, m) => s + m.amount, 0);
  const add = tm.filter((m) => m.kind === "ADD" && m.counted).reduce((s, m) => s + m.amount, 0);
  return takenTm - take + add;
}

/** Cảnh báo đếm tiền: "Thiếu 200.000" / "Thừa 50.000" ("" khi khớp) */
export function mismatchText(diff: number | null | undefined) {
  const d = Math.round(Number(diff) || 0);
  if (!d) return "";
  return `${d < 0 ? "Thiếu" : "Thừa"} ${Math.abs(d).toLocaleString("vi-VN")}`;
}

/**
 * Sửa tiền mặt theo số đếm thực tế. dayTm = tiền mặt ngày đang hiện (chốt ca − nộp + rút), closingTm = tiền mặt luỹ kế ca cuối,
 * original = số nhân viên chốt ban đầu (lần sửa trước đã lưu) → tiền mặt mới của ca cuối + chênh lệch so với số gốc.
 */
export function recountCash({ counted, dayTm, closingTm, original }: { counted: number; dayTm: number; closingTm: number; original?: number | null }) {
  const net = closingTm - dayTm; // phiếu nộp TM → TK (trừ rút) của ngày đó
  const newTm = counted + net;
  const base = original ?? closingTm;
  return { newTm, original: base, diff: newTm - base };
}

export function cashBalance({ revenue, bills, moves, payroll = [] }: { revenue: { tk: number; tm: number; app?: number }[]; bills: { amount: number }[]; moves: CashMove[]; payroll?: { amount: number }[] }) {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
  const of = (kind: CashKind, acc?: CashAccount) =>
    sum(moves.filter((m) => m.kind === kind && (!acc || (m.account ?? "TK") === acc)).map((m) => m.amount));
  const deposit = of("DEPOSIT");
  const withdraw = of("WITHDRAW");
  const side = (revenue: number, billsAmt: number, pay: number, acc: CashAccount, tIn: number, tOut: number, app = 0): CashSide => {
    const take = of("TAKE", acc);
    const add = of("ADD", acc);
    return { revenue, app, bills: billsAmt, payroll: pay, take, add, transferIn: tIn, transferOut: tOut, balance: revenue + app - billsAmt - pay - take + add + tIn - tOut };
  };
  return {
    // lương đã trả: chuyển khoản từ tài khoản
    tk: side(sum(revenue.map((r) => r.tk)), sum(bills.map((b) => b.amount)), sum(payroll.map((p) => p.amount)), "TK", deposit, withdraw, sum(revenue.map((r) => r.app ?? 0))),
    tm: side(sum(revenue.map((r) => r.tm)), 0, 0, "TM", withdraw, deposit),
  };
}

/** Phí sàn mặc định khi cơ sở chưa cài % (Cài đặt tài chính) */
export const DEFAULT_APP_FEE_PCT = 30;
/** Grab / Shopee hãng chuyển về tài khoản = doanh thu − phí sàn (% cơ sở; chưa cài → 30%). */
export function appPayout(grab: number, shopee: number, fee?: { grab?: number | null; shopee?: number | null }) {
  const pct = (p?: number | null) => (p && p > 0 ? p : DEFAULT_APP_FEE_PCT);
  return Math.round((grab || 0) * (1 - pct(fee?.grab) / 100) + (shopee || 0) * (1 - pct(fee?.shopee) / 100));
}

/** Tách theo tháng: before = trước ngày 1 của tháng (để tính số tồn), within = trong tháng đó. */
export function splitByMonth<T extends { date: string }>(xs: T[], month: string) {
  const start = `${month}-01`;
  const end = `${month}-31`;
  return { before: xs.filter((x) => x.date < start), within: xs.filter((x) => x.date >= start && x.date <= end) };
}

/**
 * Sổ quỹ theo tháng: số dư cuối tháng trước (tính lại từ toàn bộ phiếu → sửa phiếu tháng trước tự đổi số tồn tháng sau)
 * + các khoản phát sinh trong tháng. Phiếu sau tháng đang xem không tính (xem tháng cũ = số dư cuối tháng đó).
 */
export function monthCashbook({ month, revenue, bills, moves, payroll = [] }: {
  month: string;
  revenue: { date: string; tk: number; tm: number; app?: number }[];
  bills: { date: string; amount: number }[];
  moves: (CashMove & { date: string })[];
  payroll?: { date: string; amount: number }[];
}) {
  const [r, b, m, p] = [revenue, bills, moves, payroll].map((xs) => splitByMonth(xs as { date: string }[], month)) as [
    { before: typeof revenue; within: typeof revenue },
    { before: typeof bills; within: typeof bills },
    { before: typeof moves; within: typeof moves },
    { before: typeof payroll; within: typeof payroll },
  ];
  const open = cashBalance({ revenue: r.before, bills: b.before, moves: m.before, payroll: p.before });
  const cur = cashBalance({ revenue: r.within, bills: b.within, moves: m.within, payroll: p.within });
  return {
    opening: { tk: open.tk.balance, tm: open.tm.balance },
    tk: { ...cur.tk, balance: open.tk.balance + cur.tk.balance },
    tm: { ...cur.tm, balance: open.tm.balance + cur.tm.balance },
  };
}
