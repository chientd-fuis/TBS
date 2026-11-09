import { requireActiveUser } from "@/lib/guards";
import { Store } from "@/lib/models";
import Link from "next/link";
import { ShieldCheck, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";
import BottomNav from "@/components/user/BottomNav";
import RegRequestAlert from "@/components/user/RegRequestAlert";
import UserNotices from "@/components/user/UserNotices";
import RulesButton from "@/components/user/RulesButton";
import { getAiConfig, roleAllowed, rulesShown, userAiRole } from "@/lib/ai";

// các nút AI (Hỏi AI, Trợ lý, Giải thích lương, Gợi ý số người) gọi Gemini 1–2 lần → cho server chạy tối đa 60 giây
export const maxDuration = 60;

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).select("name timezone").lean();
  const ai = await getAiConfig().catch(() => null);
  const rules = ai ? rulesShown(ai) : "";
  const showAssistant = !!ai && ai.enabled && ai.features.assistant.enabled && roleAllowed(ai, "assistant", userAiRole(user));
  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-primary px-4 py-2 shadow-sm">
        <Logo size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-xs">{store?.name}</p>
        </div>
        {showAssistant && (
          <Link href="/assistant" className="flex items-center gap-1 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30">
            <Sparkles size={15} /> Hỏi trợ lý
          </Link>
        )}
        {/* quản lý: nút "Quản lý"; nhân viên: nút "Nội quy" (badge NEW khi admin cập nhật) */}
        {user.managerPerms?.length ? (
          <Link href="/manage" className="flex items-center gap-1 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs font-bold text-accent ring-1 ring-accent/30">
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
  );
}
