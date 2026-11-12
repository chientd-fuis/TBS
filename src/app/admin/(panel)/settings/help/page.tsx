import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { getHelp } from "@/lib/help-server";
import { PageTitle } from "@/components/ui";
import HelpEditor from "./HelpEditor";

export const dynamic = "force-dynamic";

/** Cài đặt → Help: nội dung nút "?" trên app nhân viên (Admin Tổng). */
export default async function HelpSettingsPage() {
  await requireOwner();
  const help = await getHelp();
  return (
    <>
      <PageTitle sub="Nội dung nút “?” Trợ giúp trên app nhân viên – soạn bên trái, xem trước bên phải">
        <Link href="/admin/settings" className="text-sm font-normal underline">Cài đặt</Link> / Help
      </PageTitle>
      <HelpEditor initial={help} />
    </>
  );
}
