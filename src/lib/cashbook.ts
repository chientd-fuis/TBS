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

export type CashSide = { revenue: number; bills: number; take: number; add: number; transferIn: number; transferOut: number; balance: number };

export function cashBalance({ revenue, bills, moves }: { revenue: { tk: number; tm: number }[]; bills: { amount: number }[]; moves: CashMove[] }) {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + (Number(x) || 0), 0);
  const of = (kind: CashKind, acc?: CashAccount) =>
    sum(moves.filter((m) => m.kind === kind && (!acc || (m.account ?? "TK") === acc)).map((m) => m.amount));
  const deposit = of("DEPOSIT");
  const withdraw = of("WITHDRAW");
  const side = (revenue: number, billsAmt: number, acc: CashAccount, tIn: number, tOut: number): CashSide => {
    const take = of("TAKE", acc);
    const add = of("ADD", acc);
    return { revenue, bills: billsAmt, take, add, transferIn: tIn, transferOut: tOut, balance: revenue - billsAmt - take + add + tIn - tOut };
  };
  return {
    tk: side(sum(revenue.map((r) => r.tk)), sum(bills.map((b) => b.amount)), "TK", deposit, withdraw),
    tm: side(sum(revenue.map((r) => r.tm)), 0, "TM", withdraw, deposit),
  };
}
