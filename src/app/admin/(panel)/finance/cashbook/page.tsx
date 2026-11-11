import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import Link from "next/link";
import type { ReactNode } from "react";
import { CashCount, CashTransfer, Expense, Payroll, PayrollItem, ShiftClosing, Store, User } from "@/lib/models";
import { dayRevenueFromClosings } from "@/lib/revenue";
import {
  CASH_KINDS,
  actualCash,
  applyDayTransfers,
  cashBalance,
  cashKindOf,
  payrollEntries,
  type CashSide,
} from "@/lib/cashbook";
import { addDays, localDate } from "@/lib/time";
import { Badge, Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import {
  deleteCashTransfer,
  saveCashTransfer,
  toggleTransferCounted,
} from "@/app/admin/actions/finance";
import { cn } from "@/lib/format";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Sổ quỹ cả chuỗi = tiền đang có đến hôm nay (cộng dồn từ trước đến nay, không theo tháng / cơ sở).
 * Admin Tổng ghi / xoá phiếu; admin được cấp quyền "Xem sổ quỹ" chỉ xem.
 */
export default async function CashbookPage() {
  const admin = await requirePerm("finance.cashbook");
  const owner = admin.kind === "OWNER";
  // số tiền thực tế đã lấy (Đếm tiền): Admin Tổng + admin được cấp quyền
  // chi tiết (đã lấy / chưa lấy) kèm luôn số thực tế; trang Đếm tiền chỉ Admin Tổng
  const seeCountDetail = can(admin, "finance.cashcount.detail");
  const seeCount = seeCountDetail || can(admin, "finance.cashcount");
  await connectDB();
  const [stores, closings, bills, all, payrolls, payItems, counts] = await Promise.all([
    Store.find().select("name").lean(),
    ShiftClosing.find({ "revenue.tm": { $ne: null } })
      .select("storeId workDate shiftName createdAt revenue")
      .lean(),
    // bill Admin Tổng trả / chuyển khoản (bill lấy tiền két đã nằm trong tiền mặt chốt ca → không trừ lại).
    // Bỏ bill mục "Lương" – lương đã trả lấy từ bảng lương (tránh trừ 2 lần)
    Expense.find({ paidFrom: { $ne: "CASHBOX" }, category: { $ne: "LUONG" } })
      .select("amount")
      .lean(),
    CashTransfer.find().sort({ date: -1, createdAt: -1 }).lean(),
    Payroll.find({ $or: [{ status: "PAID" }, { paidAt: { $ne: null } }] }).select("storeId month status paidAt").lean(),
    PayrollItem.find({ paidAt: { $ne: null } }).select("payrollId userId userName netPay paidAt").lean(),
    CashCount.find().select("storeId date").lean(),
  ]);
  // lương đã trả → phiếu "Thanh toán lương tháng xx" (tự sinh, trừ tài khoản)
  const payUsers = new Map(
    (await User.find({ _id: { $in: payItems.map((i) => i.userId) } }).select("name status").lean()).map((u) => [String(u._id), u]),
  );
  const storeShort = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
  const pays = payrollEntries(
    payrolls.map((p) => ({ id: String(p._id), month: p.month, store: storeShort.get(String(p.storeId)) ?? "", status: p.status, paidAt: p.paidAt })),
    payItems.map((i) => {
      const u = payUsers.get(String(i.userId));
      return { payrollId: String(i.payrollId), netPay: i.netPay ?? 0, paidAt: i.paidAt, name: i.userName || u?.name || "", quit: u?.status === "INACTIVE" };
    }),
    (d) => localDate(d),
  );
  // Phiếu nộp TM → TK / rút TK → TM (Admin Tổng ghi ở Doanh thu theo ngày) KHÔNG phải phiếu sổ quỹ:
  // chỉ đổi doanh thu tiền mặt / tài khoản → gộp vào dòng doanh thu, không liệt kê ở đây.
  const moves = all.filter((t) => t.kind === "TAKE" || t.kind === "ADD");
  const shift = all.filter((t) => t.kind === "DEPOSIT" || t.kind === "WITHDRAW").map((t) => (t.kind === "DEPOSIT" ? t.amount : -t.amount));
  const fund = cashBalance({
    revenue: [...dayRevenueFromClosings(closings), ...shift.map((n) => ({ tk: n, tm: -n }))],
    bills,
    moves,
    payroll: pays,
  });
  // Đếm tiền: tiền mặt các ngày đã đi lấy & đếm (số tiền mặt doanh thu ngày đó, sau phiếu nộp / rút)
  const counted = new Set(counts.map((c) => `${c.storeId}|${c.date}`));
  const dayRows = applyDayTransfers(dayRevenueFromClosings(closings), all);
  const takenTm = dayRows.filter((r) => counted.has(`${r.storeId}|${r.date}`)).reduce((s, r) => s + r.tm, 0);
  const realTm = actualCash(takenTm, moves);
  const notTaken = dayRows.filter((r) => !counted.has(`${r.storeId}|${r.date}`));
  const nameOf = new Map(
    stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]),
  );
  const today = localDate(new Date());
  // Lịch sử ghi phiếu + chi tiết 2 ô: Admin Tổng cấp quyền xem toàn bộ / 7 ngày gần nhất; không có → chỉ thấy 2 số dư
  const histAll = can(admin, "finance.cashbook.history");
  const hist7 = !histAll && can(admin, "finance.cashbook.history7");
  const showHist = histAll || hist7;
  const since = hist7 ? addDays(today, -6) : "";
  const histPays = pays.filter((p) => p.date >= since);
  const histMoves = moves.filter((t) => t.date >= since);

  return (
    <div className="space-y-4">
      <Card title="💰 Sổ quỹ cả chuỗi – tiền đang có đến hôm nay">
        <div className="grid gap-3 sm:grid-cols-2">
          <FundBox
            title="🏦 Tài khoản"
            side={fund.tk}
            rows={!showHist ? [] : [
              ["Doanh thu tài khoản", fund.tk.revenue, 1],
              ["Bill chuyển khoản", fund.tk.bills, -1],
              ["Thanh toán lương", fund.tk.payroll, -1],
              ["Rút lãi", fund.tk.take, -1],
              ["Bổ sung vốn", fund.tk.add, 1],
            ]}
          />
          <FundBox
            title="💵 Tiền mặt"
            side={fund.tm}
            sub={seeCount ? realTm : undefined}
            rows={!showHist ? [] : [
              ["Doanh thu tiền mặt", fund.tm.revenue, 1],
              ["Đã rút", fund.tm.take, -1],
              ["Bổ sung vốn", fund.tm.add, 1],
            ]}
            extra={
              seeCountDetail && <div className="mt-2 border-t border-dashed border-[#e9d9a8] pt-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink/70" title="Tiền thực tế đã qua các cửa hàng lấy về và đếm (tích ở Đếm tiền)">✓ Thực tế đã lấy</span>
                  <b className="tabular-nums text-secondary-dark">{vnd(takenTm)}</b>
                </div>
                <div className="flex items-center justify-between gap-2 text-ink/60">
                  <span>Chưa lấy ({notTaken.length} ngày)</span>
                  <span className="tabular-nums">{vnd(notTaken.reduce((s, r) => s + r.tm, 0))}</span>
                </div>
                {owner && (
                <Link href="/admin/finance/cashbook/count" className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-semibold text-accent ring-1 ring-[#e9d9a8] hover:bg-primary-light">
                  🧮 Đếm tiền →
                </Link>
                )}
              </div>
            }
          />
        </div>
        <p className="mt-2 text-[11px] text-ink/50">
          Cộng dồn từ ngày đầu có chốt ca đến nay, tất cả cơ sở. Tiền mặt chốt
          ca đã trừ chi phí két; bill trả bằng tiền két không trừ lại.
          {owner &&
            " Tiền có sẵn lúc bắt đầu dùng app → ghi 1 phiếu “Bổ sung vốn”. "}
        </p>
      </Card>

      {showHist && (
      <Card title={owner ? "Ghi phiếu" : `Các phiếu đã ghi${hist7 ? " · 7 ngày gần nhất" : ""} (${histMoves.length})`}>
        {owner && (
          <ActionForm
            action={saveCashTransfer}
            submitLabel="Ghi phiếu"
            successText="Đã ghi"
            className="mb-3 space-y-2"
          >
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-[15rem_10rem_9rem_1fr] lg:items-end">
              <div className="col-span-2 lg:col-span-1">
                <Field label="Loại">
                  <Select name="kind" defaultValue="TAKE_TK">
                    {CASH_KINDS.filter(
                      (k) => k.kind === "TAKE" || k.kind === "ADD",
                    ).map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Ngày">
                <Input
                  type="date"
                  name="date"
                  defaultValue={today}
                  max={today}
                  required
                />
              </Field>
              <Field label="Số tiền">
                <Input
                  name="amount"
                  inputMode="numeric"
                  required
                  placeholder="5tr / 5000000"
                  className="text-right"
                />
              </Field>
              <div className="col-span-2 lg:col-span-1">
                <Field label="Ghi chú">
                  <Input name="note" placeholder="Tuỳ chọn" />
                </Field>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink/70">
              <input type="checkbox" name="counted" className="h-4 w-4" />
              Bổ sung vốn tiền mặt: đã lấy (cộng vào tiền thực tế đang cầm)
            </label>
          </ActionForm>
        )}
        {histPays.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-ink/60">Thanh toán lương – tự ghi khi bảng lương “Đã trả” (trừ tài khoản)</p>
            <ul className="divide-y divide-[#f1e6c8] text-sm">
              {histPays.slice(0, 60).map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 py-1.5">
                  <span className="w-20 tabular-nums">{p.date.slice(8)}/{p.date.slice(5, 7)}/{p.date.slice(2, 4)}</span>
                  <Badge tone="red">Lương</Badge>
                  <b className="tabular-nums">−{vnd(p.amount)}</b>
                  <span className="min-w-0 flex-1 text-xs text-ink/60">{p.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {!histMoves.length ? (
          <p className="text-sm text-ink/50">Chưa có phiếu nào.</p>
        ) : (
          <ul className="divide-y divide-[#f1e6c8] text-sm">
            {histMoves.slice(0, 200).map((t) => {
              const k = cashKindOf(t);
              const out = t.kind === "TAKE";
              return (
                <li
                  key={String(t._id)}
                  className="flex flex-wrap items-center gap-2 py-1.5"
                >
                  <span className="w-20 tabular-nums">
                    {t.date.slice(8)}/{t.date.slice(5, 7)}/{t.date.slice(2, 4)}
                  </span>
                  <Badge
                    tone={out ? "red" : t.kind === "ADD" ? "green" : "blue"}
                  >
                    {k?.short ?? t.kind}
                  </Badge>
                  <b className="tabular-nums">
                    {out ? "−" : t.kind === "ADD" ? "+" : ""}
                    {vnd(t.amount)}
                  </b>
                  {t.storeId && (
                    <span className="text-xs text-ink/50">
                      {nameOf.get(String(t.storeId))}
                    </span>
                  )}
                  {t.kind === "ADD" && t.account === "TM" && seeCountDetail && (
                    owner ? (
                      <ActionForm action={toggleTransferCounted} submitLabel={t.counted ? "✓ Đã lấy" : "Chưa lấy"} variant={t.counted ? "outline" : "ghost"} successText="" className="inline-block" buttonClassName="!px-2 !py-0.5 text-xs">
                        <input type="hidden" name="id" value={String(t._id)} />
                      </ActionForm>
                    ) : (
                      <span className="text-xs text-ink/50">{t.counted ? "✓ Đã lấy" : "Chưa lấy"}</span>
                    )
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-ink/60">
                    {t.note}
                  </span>
                  {owner && (
                    <ActionForm
                      action={deleteCashTransfer}
                      submitLabel="Xoá"
                      variant="ghost"
                      successText=""
                      confirm={`Xoá phiếu ${vnd(t.amount)} ngày ${t.date.slice(8)}/${t.date.slice(5, 7)}?`}
                    >
                      <input type="hidden" name="id" value={String(t._id)} />
                    </ActionForm>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      )}
    </div>
  );
}

/** 1 ô số dư: số lớn + các khoản cộng / trừ để soát */
function FundBox({
  title,
  side,
  rows,
  extra,
  sub,
}: {
  title: string;
  side: CashSide;
  rows: [string, number, 1 | -1][];
  extra?: ReactNode;
  /** số nhỏ, mờ cạnh số dư (tiền mặt thực tế đang cầm) */
  sub?: number;
}) {
  return (
    <div className="rounded-2xl bg-cream p-3 ring-1 ring-[#f1e6c8]">
      <p className="text-sm font-bold text-accent">{title}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          side.balance < 0 && "text-danger",
        )}
      >
        {vnd(side.balance)}
        {sub != null && (
          <span className="ml-2 align-baseline text-sm font-semibold text-ink/45" title="Thực tế đang cầm: tiền mặt các ngày đã lấy & đếm − đã rút + vốn đã lấy">
            {vnd(sub)}
          </span>
        )}
      </p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-xs">
        {rows
          .filter(([, v], i) => i === 0 || v)
          .map(([label, v, sign]) => (
            <div key={label} className="contents">
              <dt className="text-ink/60">{label}</dt>
              <dd
                className={cn(
                  "text-right tabular-nums",
                  sign < 0 ? "text-danger" : "text-secondary-dark",
                )}
              >
                {sign < 0 ? "−" : "+"}
                {vnd(v)}
              </dd>
            </div>
          ))}
      </dl>
      {extra}
    </div>
  );
}
