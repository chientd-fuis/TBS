import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { loadPnl, loadStores } from "@/lib/finance-data";
import { addDays, localDate, localMonth, monthRange, prevMonth } from "@/lib/time";
import PeriodPicker, { spanDays } from "./PeriodPicker";
import PnlView from "./PnlView";
import { Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 400;

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string; alloc?: string; from?: string; to?: string }> }) {
  const admin = await requireAdmin();
  if (admin.kind !== "OWNER") {
    // Lãi lỗ chỉ Admin Tổng – admin vào tab tài chính đầu tiên được cấp
    const first = (
      [
        ["finance.revenue", "/admin/finance/revenue"],
        ["finance.shiftExpenses", "/admin/finance/shift-expenses"],
        ["finance.bills", "/admin/finance/expenses"],
        ["finance.rent", "/admin/finance/fixed"],
        ["finance.cashbook", "/admin/finance/cashbook"],
        ["finance.settings", "/admin/finance/settings"],
      ] as const
    ).find(([p]) => can(admin, p));
    redirect(first ? first[1] : "/admin?error=forbidden");
  }
  const sp = await searchParams;
  const alloc = sp.alloc === "1";
  const today = localDate(new Date());

  // Khoảng ngày tuỳ chọn (?from=&to=, VD 15/11 → 14/12) – không có thì xem theo tháng
  if (YMD.test(sp.from ?? "") && YMD.test(sp.to ?? "")) {
    const [from, end] = sp.from! <= sp.to! ? [sp.from!, sp.to!] : [sp.to!, sp.from!];
    const month = from.slice(0, 7);
    const picker = <PeriodPicker mode="range" month={month} from={from} to={end} alloc={alloc} />;
    if (spanDays(from, end) > MAX_DAYS)
      return (
        <Card>
          {picker}
          <Empty>Khoảng dài quá – chọn tối đa {MAX_DAYS} ngày.</Empty>
        </Card>
      );
    if (from > today)
      return (
        <Card>
          {picker}
          <Empty>Khoảng này chưa bắt đầu.</Empty>
        </Card>
      );
    const to = end > today ? today : end; // phần chưa tới thì chưa tính
    // kỳ trước: liền trước, cùng số ngày đã tính (VD 15/11–20/11 so với 09/11–14/11)
    const n = spanDays(from, to);
    const prevTo = addDays(from, -1);
    const prevFirst = addDays(from, -n);
    const stores = await loadStores({ from: prevFirst, to });
    const [{ pnl, dates }, prev] = await Promise.all([loadPnl(from, to, stores), loadPnl(prevFirst, prevTo, stores)]);
    return (
      <PnlView
        period={{ mode: "range", month, from, to: end }}
        first={from}
        to={to}
        prevFirst={prevFirst}
        prevTo={prevTo}
        stores={stores}
        pnl={pnl}
        dates={dates}
        prev={prev.pnl}
        alloc={alloc}
      />
    );
  }

  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const { first, last } = monthRange(month);
  const to = month === today.slice(0, 7) ? today : last;
  if (first > today) {
    return (
      <Card>
        <PeriodPicker mode="month" month={month} from={first} to={last} alloc={alloc} />
        <Empty>Tháng này chưa bắt đầu.</Empty>
      </Card>
    );
  }
  // kỳ trước: cùng số ngày của tháng trước (VD 1–8/10 so với 1–8/11)
  const pm = monthRange(prevMonth(month));
  const span = Number(to.slice(8)) - 1;
  const prevTo = addDays(pm.first, span) > pm.last ? pm.last : addDays(pm.first, span);
  const stores = await loadStores({ from: pm.first, to });
  const [{ pnl, dates }, prev] = await Promise.all([loadPnl(first, to, stores), loadPnl(pm.first, prevTo, stores)]);
  return (
    <PnlView
      period={{ mode: "month", month, from: first, to: last }}
      first={first}
      to={to}
      prevFirst={pm.first}
      prevTo={prevTo}
      stores={stores}
      pnl={pnl}
      dates={dates}
      prev={prev.pnl}
      alloc={alloc}
    />
  );
}
