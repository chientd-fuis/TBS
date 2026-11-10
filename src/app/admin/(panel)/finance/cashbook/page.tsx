import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { CashTransfer, Expense, ShiftClosing, Store } from "@/lib/models";
import { dayRevenueFromClosings } from "@/lib/revenue";
import { CASH_KINDS, cashBalance, cashKindOf, type CashSide } from "@/lib/cashbook";
import { localDate } from "@/lib/time";
import { Badge, Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { deleteCashTransfer, saveCashTransfer } from "@/app/admin/actions/finance";
import { cn } from "@/lib/format";

export const dynamic = "force-dynamic";
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Sổ quỹ cả chuỗi = tiền đang có đến hôm nay (cộng dồn từ trước đến nay, không theo tháng / cơ sở).
 * Admin Tổng ghi / xoá phiếu; admin được cấp quyền "Xem sổ quỹ" chỉ xem.
 */
export default async function CashbookPage() {
  const admin = await requirePerm("finance.cashbook");
  const owner = admin.kind === "OWNER";
  await connectDB();
  const [stores, closings, bills, moves] = await Promise.all([
    Store.find().select("name").lean(),
    ShiftClosing.find({ "revenue.tm": { $ne: null } }).select("storeId workDate shiftName createdAt revenue").lean(),
    // bill Admin Tổng trả / chuyển khoản (bill lấy tiền két đã nằm trong tiền mặt chốt ca → không trừ lại)
    Expense.find({ paidFrom: { $ne: "CASHBOX" } }).select("amount").lean(),
    CashTransfer.find().sort({ date: -1, createdAt: -1 }).lean(),
  ]);
  const fund = cashBalance({ revenue: dayRevenueFromClosings(closings), bills, moves });
  const nameOf = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
  const today = localDate(new Date());

  return (
    <div className="space-y-4">
      <Card title="💰 Sổ quỹ cả chuỗi – tiền đang có đến hôm nay">
        <div className="grid gap-3 sm:grid-cols-2">
          <FundBox
            title="🏦 Tài khoản"
            side={fund.tk}
            rows={[
              ["Doanh thu tài khoản", fund.tk.revenue, 1],
              ["Bill chuyển khoản", fund.tk.bills, -1],
              ["Rút lãi", fund.tk.take, -1],
              ["Bổ sung vốn", fund.tk.add, 1],
              ["Nộp tiền mặt vào", fund.tk.transferIn, 1],
              ["Rút ra tiền mặt", fund.tk.transferOut, -1],
            ]}
          />
          <FundBox
            title="💵 Tiền mặt"
            side={fund.tm}
            rows={[
              ["Doanh thu tiền mặt", fund.tm.revenue, 1],
              ["Đã rút", fund.tm.take, -1],
              ["Bổ sung vốn", fund.tm.add, 1],
              ["Rút từ tài khoản", fund.tm.transferIn, 1],
              ["Nộp vào tài khoản", fund.tm.transferOut, -1],
            ]}
          />
        </div>
        <p className="mt-2 text-[11px] text-ink/50">
          Cộng dồn từ ngày đầu có chốt ca đến nay, tất cả cơ sở. Tiền mặt chốt ca đã trừ chi phí két; bill trả bằng tiền két không trừ lại.
          {owner && " Tiền có sẵn lúc bắt đầu dùng app → ghi 1 phiếu “Bổ sung vốn”. Nộp tiền mặt vào TK / rút TK ra tiền mặt: ghi ở tab Doanh thu theo ngày."}
        </p>
      </Card>

      <Card title={owner ? "Ghi phiếu" : `Các phiếu đã ghi (${moves.length})`}>
        {owner && (
          <ActionForm action={saveCashTransfer} submitLabel="Ghi phiếu" successText="Đã ghi" className="mb-3 grid gap-2 sm:grid-cols-[1fr_10rem_9rem] sm:items-end">
            <Field label="Loại">
              <Select name="kind" defaultValue="TAKE_TK">
                {CASH_KINDS.filter((k) => k.kind === "TAKE" || k.kind === "ADD").map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ngày"><Input type="date" name="date" defaultValue={today} max={today} required /></Field>
            <Field label="Số tiền"><Input name="amount" inputMode="numeric" required placeholder="5tr / 5000000" className="text-right" /></Field>
            <div className="sm:col-span-3"><Input name="note" placeholder="Ghi chú (tuỳ chọn)" /></div>
          </ActionForm>
        )}
        {!moves.length ? (
          <p className="text-sm text-ink/50">Chưa có phiếu nào.</p>
        ) : (
          <ul className="divide-y divide-[#f1e6c8] text-sm">
            {moves.slice(0, 200).map((t) => {
              const k = cashKindOf(t);
              const out = t.kind === "TAKE";
              return (
                <li key={String(t._id)} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="w-20 tabular-nums">{t.date.slice(8)}/{t.date.slice(5, 7)}/{t.date.slice(2, 4)}</span>
                  <Badge tone={out ? "red" : t.kind === "ADD" ? "green" : "blue"}>{k?.short ?? t.kind}</Badge>
                  <b className="tabular-nums">{out ? "−" : t.kind === "ADD" ? "+" : ""}{vnd(t.amount)}</b>
                  {t.storeId && <span className="text-xs text-ink/50">{nameOf.get(String(t.storeId))}</span>}
                  <span className="min-w-0 flex-1 truncate text-xs text-ink/60">{t.note}</span>
                  {owner && (
                    <ActionForm action={deleteCashTransfer} submitLabel="Xoá" variant="ghost" successText="" confirm={`Xoá phiếu ${vnd(t.amount)} ngày ${t.date.slice(8)}/${t.date.slice(5, 7)}?`}>
                      <input type="hidden" name="id" value={String(t._id)} />
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** 1 ô số dư: số lớn + các khoản cộng / trừ để soát */
function FundBox({ title, side, rows }: { title: string; side: CashSide; rows: [string, number, 1 | -1][] }) {
  return (
    <div className="rounded-2xl bg-cream p-3 ring-1 ring-[#f1e6c8]">
      <p className="text-sm font-bold text-accent">{title}</p>
      <p className={cn("text-2xl font-bold tabular-nums", side.balance < 0 && "text-danger")}>{vnd(side.balance)}</p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        {rows
          .filter(([, v], i) => i === 0 || v)
          .map(([label, v, sign]) => (
            <div key={label} className="contents">
              <dt className="text-ink/60">{label}</dt>
              <dd className={cn("text-right tabular-nums", sign < 0 ? "text-danger" : "text-secondary-dark")}>
                {sign < 0 ? "−" : "+"}
                {vnd(v)}
              </dd>
            </div>
          ))}
      </dl>
    </div>
  );
}
