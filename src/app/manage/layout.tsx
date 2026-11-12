import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireActiveUser } from "@/lib/guards";
import { STAFF_PERMS } from "@/lib/permissions";
import { Logo } from "@/components/Logo";
import ManageTabs from "./ManageTabs";
import NavProgress from "@/components/NavProgress";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

const HREF: Record<string, string> = { schedule: "/manage/schedule", bonus: "/manage/bonus", cover: "/manage/requests" };

/** Khu Quản lý cho nhân viên được admin cấp quyền (xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ). Rộng hơn app chấm công. */
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const perms = STAFF_PERMS.filter((p) => user.managerPerms?.includes(p.key));
  if (!perms.length) redirect("/");
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-primary px-4 py-2 shadow-sm">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <Link href="/" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold hover:bg-white/40">
          <ArrowLeft size={16} /> App
        </Link>
        <Logo size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">Quản lý</p>
          <p className="truncate text-xs">{user.name}</p>
        </div>
      </header>
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        <ManageTabs tabs={perms.map((p) => ({ href: HREF[p.key], label: p.label }))} />
        {children}
      </div>
    </div>
  );
}
