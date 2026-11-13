import { requireActiveUser } from "@/lib/guards";
import { Store } from "@/lib/models";
import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import BottomNav from "@/components/user/BottomNav";
import RegRequestAlert from "@/components/user/RegRequestAlert";
import UserNotices from "@/components/user/UserNotices";
import RulesButton from "@/components/user/RulesButton";
import HelpButton from "@/components/user/HelpButton";
import NavProgress from "@/components/NavProgress";
import { Suspense } from "react";
import { getAiConfig, roleAllowed, rulesShown, userAiRole } from "@/lib/ai";
import { isProbation } from "@/lib/probation";
import { cn } from "@/lib/format";
import { THEME_ROOT_ID, themeClass, themeOf } from "@/lib/themes";
import { themeViewport } from "@/lib/theme-server";

// các nút AI (Hỏi AI, Trợ lý, Giải thích lương, Gợi ý số người) gọi Gemini 1–2 lần → cho server chạy tối đa 60 giây
export const maxDuration = 60;

// thanh trạng thái điện thoại cùng màu đầu trang của theme đang dùng
export const generateViewport = themeViewport;

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).select("name timezone").lean();
  const ai = await getAiConfig().catch(() => null);
  const rules = ai ? rulesShown(ai) : "";
  const showAssistant = !!ai && ai.enabled && ai.features.assistant.enabled && roleAllowed(ai, "assistant", userAiRole(user));
  // thử việc → cả app (kể cả thanh menu dưới) đổi sang màu hồng tím; còn lại theo màu nhân viên chọn (Tài khoản → Màu giao diện)
  const trial = isProbation(user);
  return (
    <div id={THEME_ROOT_ID} className={cn("min-h-screen", themeClass(themeOf(user)))}>
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-header px-4 py-2 text-on-header shadow-sm">
        {/* vạch tiến trình chuyển trang – mép dưới header */}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {/* bấm logo / tên → về trang chủ chấm công */}
        <Link href="/" aria-label="Về trang chủ chấm công" className="flex min-w-0 flex-1 items-center gap-3">
          <Logo size={36} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate text-sm font-bold">
              <span className="truncate">{user.name}</span>
              {trial && <span className="shrink-0 rounded-full bg-chip px-1.5 py-0.5 text-[10px] font-bold text-accent">Thử việc</span>}
            </span>
            <span className="block truncate text-xs">{store?.name}</span>
          </span>
        </Link>
        {showAssistant && (
          <Link href="/assistant" className="flex items-center gap-1 rounded-xl bg-chip px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30">
            <Sparkles size={15} /> Hỏi trợ lý
          </Link>
        )}
        {/* "?" Trợ giúp: hướng dẫn app, quy trình theo vị trí, thông tin quán, tình huống hay gặp */}
        <HelpButton />
        {/* quản lý: nút "Quản lý"; nhân viên: nút "Nội quy" (badge NEW khi admin cập nhật) */}
        {user.managerPerms?.length ? (
          <Link href="/manage" className="flex items-center gap-1 rounded-xl bg-chip px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30">
            <ShieldCheck size={15} /> Quản lý
          </Link>
        ) : (
          <RulesButton rules={rules} assistant={showAssistant} />
        )}
      </header>
      <main className="space-y-4 p-4">
        <UserNotices userId={user._id} />
        <RegRequestAlert userId={user._id} tz={store?.timezone || "Asia/Ho_Chi_Minh"} />
        {children}
      </main>
      <BottomNav />
    </div>
    </div>
  );
}
