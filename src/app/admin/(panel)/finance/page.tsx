import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { loadPnl, loadStores } from "@/lib/finance-data";
import { addDays, localDate, localMonth, monthRange, prevMonth } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import PnlView from "./PnlView";
import { Card, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string; alloc?: string }> }) {
  const admin = await requireAdmin();
  if (admin.kind !== "OWNER") {
    // Lãi lỗ chỉ Admin Tổng – admin vào tab tài chính đầu tiên được cấp
    const first = (
      [
        ["finance.shiftExpenses", "/admin/finance/shift-expenses"],
        ["finance.bills", "/admin/finance/expenses"],
        ["finance.rent", "/admin/finance/fixed"],
        ["finance.settings", "/admin/finance/settings"],
      ] as const
    ).find(([p]) => can(admin, p));
    redirect(first ? first[1] : "/admin?error=forbidden");
  }
  const sp = await searchParams;
  const today = localDate(new Date());
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const { first, last } = monthRange(month);
  const to = month === today.slice(0, 7) ? today : last;
  if (first > today) {
    return (
      <Card>
        <MonthPicker month={month} base="/admin/finance" />
        <Empty>Tháng này chưa bắt đầu.</Empty>
      </Card>
    );
  }
  // kỳ trước: cùng số ngày của tháng trước (VD 1–8/10 so với 1–8/11)
  const pm = monthRange(prevMonth(month));
  const span = Number(to.slice(8)) - 1;
  const prevTo = addDays(pm.first, span) > pm.last ? pm.last : addDays(pm.first, span);
  const stores = await loadStores();
  const [{ pnl, dates }, prev] = await Promise.all([loadPnl(first, to, stores), loadPnl(pm.first, prevTo, stores)]);
  return <PnlView month={month} first={first} to={to} prevFirst={pm.first} prevTo={prevTo} stores={stores} pnl={pnl} dates={dates} prev={prev.pnl} alloc={sp.alloc === "1"} />;
}
