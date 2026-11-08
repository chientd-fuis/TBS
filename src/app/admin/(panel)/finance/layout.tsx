import { requireAdmin } from "@/lib/guards";
import { PageTitle } from "@/components/ui";
import FinanceTabs from "./FinanceTabs";

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <>
      <PageTitle sub="Doanh thu từ chốt ca · chi phí từ bill & chi phí cố định · lương theo giờ công → lợi nhuận từng cơ sở">Tài chính</PageTitle>
      <FinanceTabs isOwner={admin.kind === "OWNER"} />
      {children}
    </>
  );
}
