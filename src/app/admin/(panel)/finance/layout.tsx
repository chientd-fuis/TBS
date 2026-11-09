import { requireAdmin } from "@/lib/guards";
import { PageTitle } from "@/components/ui";
import FinanceTabs from "./FinanceTabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <>
      <PageTitle sub="Lãi toàn chuỗi = Σ lãi gộp các cơ sở (doanh thu, chi trong ca, lương, thuê nhà) − chi phí chung admin nhập">Tài chính</PageTitle>
      <FinanceTabs isOwner={admin.kind === "OWNER"} perms={admin.perms} />
      {children}
    </>
  );
}
