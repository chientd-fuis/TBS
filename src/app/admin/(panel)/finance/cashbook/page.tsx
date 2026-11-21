import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import Link from "next/link";
import type { ReactNode } from "react";
import { AdminActivity, CashCount, CashTransfer, Expense, Payroll, PayrollItem, ShiftClosing, Store, User } from "@/lib/models";
import { recordView } from "@/lib/activity-server";
import { isCountedExpense } from "@/lib/finance";
import { adminActor } from "@/lib/admin-session";
import { viDateTime } from "@/lib/time";
import { dayRevenueFromClosings } from "@/lib/revenue";
import {
  CASH_KINDS,
  actualCash,
  applyDayTransfers,
  cashKindOf,
  appPayout,
  monthCashbook,
  payrollEntries,
  splitByMonth,
  type CashSide,
} from "@/lib/cashbook";
import { addDays, localDate, localMonth, nextMonth, prevMonth, viMonth } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
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
 * Sổ quỹ cả chuỗi theo tháng: số dư cuối tháng trước chuyển sang (tồn đọng) + phát sinh trong tháng.
 * Số tồn luôn tính lại từ toàn bộ phiếu → sửa / xoá phiếu tháng trước thì tháng sau tự đổi theo.
 * Admin Tổng ghi / sửa / xoá phiếu mọi tháng; admin được cấp quyền "Xem sổ quỹ" chỉ xem.
 */
export default async function CashbookPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const admin = await requirePerm("finance.cashbook");
  const owner = admin.kind === "OWNER";
  const thisMonth = localMonth(new Date());
  // xem tháng trước: Admin Tổng + admin được xem toàn bộ lịch sử; còn lại chỉ tháng này
  const pickMonth = owner; // chỉ Admin Tổng chọn / xem tháng cũ
  const sp = await searchParams;
  const month = pickMonth && /^\d{4}-\d{2}$/.test(sp.month ?? "") && sp.month! < thisMonth ? sp.month! : thisMonth;
  const isNow = month === thisMonth;
  // "10" (cùng năm) / "12/2025" (sang năm mới)
  const mLabel = (m: string) => (m.slice(0, 4) === month.slice(0, 4) ? String(Number(m.slice(5))) : viMonth(m));
  const prevLabel = mLabel(prevMonth(month));
  // số tiền thực tế đã lấy (Đếm tiền): Admin Tổng + admin được cấp quyền
  // chi tiết (đã lấy / chưa lấy) kèm luôn số thực tế; trang Đếm tiền chỉ Admin Tổng
  const seeCountDetail = can(admin, "finance.cashcount.detail");
  const seeCount = seeCountDetail || can(admin, "finance.cashcount");
  await connectDB();
  // admin vào xem → lịch sử hoạt động (Admin Tổng biết ai đã xem; gộp các lần tải lại trong 30 phút)
  if (!owner) await recordView(adminActor(admin), "cash.view", { month });
  // Admin Tổng: ai đã xem sổ quỹ 7 ngày gần đây
  const viewers = owner
    ? await AdminActivity.find({ action: "cash.view" }).sort({ createdAt: -1 }).limit(30).select("adminName summary createdAt").lean()
    : [];
  const [stores, closings, bills, all, payrolls, payItems, counts] = await Promise.all([
    Store.find().select("name grabFeePct shopeeFeePct").lean(),
    ShiftClosing.find({ "revenue.tm": { $ne: null }, "imported.noCashbook": { $ne: true } })
      .select("storeId workDate shiftName createdAt revenue")
      .lean(),
    // bill Admin Tổng trả / chuyển khoản (bill lấy tiền két đã nằm trong tiền mặt chốt ca → không trừ lại).
    // Theo ô "Tính vào chi phí" của bill (trống = theo mục: Lương mặc định không tính – đã có bảng lương, tránh trừ 2 lần)
    Expense.find({ paidFrom: { $ne: "CASHBOX" } })
      .select("amount date category paidFrom countInCost")
      .lean()
      .then((xs) => xs.filter(isCountedExpense)),
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
  const shift = all.filter((t) => t.kind === "DEPOSIT" || t.kind === "WITHDRAW").map((t) => ({ date: t.date, n: t.kind === "DEPOSIT" ? t.amount : -t.amount }));
  const feeOf = new Map(stores.map((s) => [String(s._id), s]));
  const fund = monthCashbook({
    month,
    revenue: [
      // Grab / Shopee: hãng trừ phí sàn rồi chuyển về tài khoản
      ...dayRevenueFromClosings(closings).map((r) => ({ ...r, app: appPayout(r.grab, r.shopee, { grab: feeOf.get(r.storeId)?.grabFeePct, shopee: feeOf.get(r.storeId)?.shopeeFeePct }) })),
      ...shift.map((t) => ({ date: t.date, tk: t.n, tm: -t.n }))],
    bills,
    moves,
    payroll: pays,
  });
  // Đếm tiền: tiền mặt các ngày đã đi lấy & đếm (số tiền mặt doanh thu ngày đó, sau phiếu nộp / rút)
  const counted = new Set(counts.map((c) => `${c.storeId}|${c.date}`));
  // tiền thực tế đang cầm cũng chuyển tháng: thực tế cuối tháng trước + đã lấy trong tháng − rút TM + vốn TM đã lấy
  const dayRows = splitByMonth(applyDayTransfers(dayRevenueFromClosings(closings), all), month);
  const isTaken = (r: { storeId: string; date: string }) => counted.has(`${r.storeId}|${r.date}`);
  const sumTm = (xs: { tm: number }[]) => xs.reduce((s, r) => s + r.tm, 0);
  const mv = splitByMonth(moves, month);
  const openReal = actualCash(sumTm(dayRows.before.filter(isTaken)), mv.before);
  const takenTm = sumTm(dayRows.within.filter(isTaken));
  const realTm = openReal + actualCash(takenTm, mv.within);
  // chưa lấy: mọi ngày đến hết tháng đang xem (kể cả tháng trước còn sót)
  const notTaken = [...dayRows.before, ...dayRows.within].filter((r) => !isTaken(r));
  const nameOf = new Map(
    stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]),
  );
  const today = localDate(new Date());
  // Lịch sử ghi phiếu + chi tiết 2 ô: Admin Tổng cấp quyền xem toàn bộ / 7 ngày gần nhất; không có → chỉ thấy 2 số dư
  const histAll = can(admin, "finance.cashbook.history");
  const hist7 = !histAll && can(admin, "finance.cashbook.history7");
  const showHist = histAll || hist7;
  const since = hist7 ? addDays(today, -6) : "";
  const histPays = splitByMonth(pays, month).within.filter((p) => p.date >= since);
  const histMoves = mv.within.filter((t) => t.date >= since);
  // ngày mặc định khi ghi phiếu: hôm nay; xem tháng cũ → ngày cuối tháng đó
  const defDate = isNow ? today : addDays(`${nextMonth(month)}-01`, -1);

  return (
    <div className="space-y-4">
      {pickMonth && (
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} base="/admin/finance/cashbook" />
          {!isNow && (
            <Link href="/admin/finance/cashbook" className="text-xs font-semibold text-accent underline">
              Về tháng này
            </Link>
          )}
        </div>
      )}
      <Card title={`💰 Sổ quỹ cả chuỗi – ${isNow ? "tiền đang có đến hôm nay" : `số dư cuối tháng ${viMonth(month)}`}`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FundBox
            title="🏦 Tài khoản"
            side={fund.tk}
            rows={!showHist ? [] : [
              [`Tồn đọng tháng ${prevLabel}`, fund.opening.tk, 1],
              ["Doanh thu tài khoản", fund.tk.revenue, 1],
              ["Grab / Shopee (đã trừ phí sàn)", fund.tk.app, 1],
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
              [`Tiền mặt từ tháng ${prevLabel}`, fund.opening.tm, 1],
              ["Doanh thu tiền mặt", fund.tm.revenue, 1],
              ["Đã rút", fund.tm.take, -1],
              ["Bổ sung vốn", fund.tm.add, 1],
            ]}
            extra={
              seeCountDetail && <div className="mt-2 border-t border-dashed border-line-strong pt-2 text-xs">
                <div className="flex items-center justify-between gap-2 text-ink/60">
                  <span>Thực tế từ tháng {prevLabel}</span>
                  <span className="tabular-nums">{vnd(openReal)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink/70" title="Tiền thực tế đã qua các cửa hàng lấy về và đếm trong tháng (tích ở Đếm tiền)">✓ Đã lấy tháng {mLabel(month)}</span>
                  <b className="tabular-nums text-good">{vnd(takenTm)}</b>
                </div>
                <div className="flex items-center justify-between gap-2 text-ink/60">
                  <span>Chưa lấy ({notTaken.length} ngày)</span>
                  <span className="tabular-nums">{vnd(notTaken.reduce((s, r) => s + r.tm, 0))}</span>
                </div>
                {owner && (
                <Link href={`/admin/finance/cashbook/count?month=${month}`} className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-card px-2.5 py-1 font-semibold text-accent ring-1 ring-line-strong hover:bg-primary-light">
                  🧮 Đếm tiền →
                </Link>
                )}
              </div>
            }
          />
        </div>
        <p className="mt-2 text-[11px] text-ink/50">
          Số dư cuối tháng trước tự chuyển sang tháng sau (tồn đọng); sửa phiếu
          tháng trước thì số tồn tháng sau đổi theo. Tất cả cơ sở. Tiền mặt chốt
          ca đã trừ chi phí két; bill trả bằng tiền két không trừ lại.
          {owner &&
            " Tiền có sẵn lúc bắt đầu dùng app → ghi 1 phiếu “Bổ sung vốn”. "}
        </p>
      </Card>

      {showHist && (
      <Card title={owner ? `Ghi phiếu · tháng ${viMonth(month)}` : `Các phiếu tháng ${viMonth(month)}${hist7 ? " · 7 ngày gần nhất" : ""} (${histMoves.length})`}>
        {owner && (
          <ActionForm
            action={saveCashTransfer}
            submitLabel="Ghi phiếu"
            successText="Đã ghi"
            className="mb-3 space-y-2"
          >
            <CashFields date={defDate} max={today} />
          </ActionForm>
        )}
        {histPays.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-ink/60">Thanh toán lương – tự ghi khi bảng lương “Đã trả” (trừ tài khoản)</p>
            <ul className="divide-y divide-line text-sm">
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
          <ul className="divide-y divide-line text-sm">
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
                    <details className="w-auto open:w-full">
                      <summary className="cursor-pointer list-none text-xs font-semibold text-accent underline">Sửa</summary>
                      <ActionForm action={saveCashTransfer} submitLabel="Lưu phiếu" successText="Đã sửa" className="mt-2 space-y-2 rounded-xl bg-cream p-2 ring-1 ring-line">
                        <input type="hidden" name="id" value={String(t._id)} />
                        <CashFields kind={k?.value} date={t.date} max={today} amount={String(t.amount)} note={t.note ?? ""} counted={!!t.counted} />
                      </ActionForm>
                    </details>
                  )}
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

      {owner && (
        <Card title={`👀 Admin đã xem sổ quỹ · 7 ngày (${viewers.length})`}>
          {!viewers.length ? (
            <p className="text-sm text-ink/50">Chưa admin nào vào xem.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {viewers.map((v) => (
                <li key={String(v._id)} className="flex flex-wrap items-center gap-x-2 py-1.5">
                  <span className="w-28 tabular-nums text-xs text-ink/60">{viDateTime(v.createdAt)}</span>
                  <b>{v.adminName}</b>
                  {v.summary && <span className="text-xs text-ink/60">xem {v.summary}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-ink/50">
            Mở lại nhiều lần trong 30 phút chỉ ghi 1 dòng. Xem thêm ở{" "}
            <Link href="/admin/activity" className="text-accent underline">Lịch sử hoạt động</Link>.
          </p>
        </Card>
      )}
    </div>
  );
}

/** Các ô của phiếu sổ quỹ (ghi mới / sửa) */
function CashFields({ kind = "TAKE_TK", date, max, amount, note, counted }: { kind?: string; date: string; max: string; amount?: string; note?: string; counted?: boolean }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-[15rem_10rem_9rem_1fr] lg:items-end">
        <div className="col-span-2 lg:col-span-1">
          <Field label="Loại">
            <Select name="kind" defaultValue={kind}>
              {CASH_KINDS.filter((k) => k.kind === "TAKE" || k.kind === "ADD").map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Ngày">
          <Input type="date" name="date" defaultValue={date} max={max} required />
        </Field>
        <Field label="Số tiền">
          <Input name="amount" inputMode="numeric" required defaultValue={amount} placeholder="5tr / 5000000" className="text-right" />
        </Field>
        <div className="col-span-2 lg:col-span-1">
          <Field label="Ghi chú">
            <Input name="note" defaultValue={note} placeholder="Tuỳ chọn" />
          </Field>
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink/70">
        <input type="checkbox" name="counted" defaultChecked={counted} className="h-4 w-4" />
        Bổ sung vốn tiền mặt: đã lấy (cộng vào tiền thực tế đang cầm)
      </label>
    </>
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
    <div className="rounded-2xl bg-cream p-3 ring-1 ring-line">
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
          .filter(([, v], i) => i < 2 || v)
          .map(([label, raw, k]) => [label, raw * k] as const)
          .map(([label, v]) => (
            <div key={label} className="contents">
              <dt className="text-ink/60">{label}</dt>
              <dd
                className={cn(
                  "text-right tabular-nums",
                  v < 0 ? "text-danger" : "text-good",
                )}
              >
                {v < 0 ? "−" : "+"}
                {vnd(Math.abs(v))}
              </dd>
            </div>
          ))}
      </dl>
      {extra}
    </div>
  );
}
