import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireActiveUser } from "@/lib/guards";
import { STAFF_PERMS } from "@/lib/permissions";
import { Logo } from "@/components/Logo";
import ManageTabs from "./ManageTabs";
import NavProgress from "@/components/NavProgress";
import { Suspense } from "react";
import { cn } from "@/lib/format";
import { THEME_ROOT_ID, themeClass, themeOf } from "@/lib/themes";
import { themeViewport } from "@/lib/theme-server";

export const dynamic = "force-dynamic";
// cùng màu giao diện nhân viên chọn ở app (Tài khoản → Màu giao diện)
export const generateViewport = themeViewport;

const HREF: Record<string, string> = { schedule: "/manage/schedule", bonus: "/manage/bonus", cover: "/manage/requests" };

/** Khu Quản lý cho nhân viên được admin cấp quyền (xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ). Rộng hơn app chấm công. */
export default async function ManageLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const perms = STAFF_PERMS.filter((p) => user.managerPerms?.includes(p.key));
  if (!perms.length) redirect("/");
  return (
    <div id={THEME_ROOT_ID} className={cn("min-h-screen", themeClass(themeOf(user)))}>
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-header px-4 py-2 text-on-header shadow-sm">
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <Link href="/" className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold hover:bg-chip">
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
