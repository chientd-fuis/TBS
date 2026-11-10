import { requireAdmin } from "@/lib/guards";
import { AdjustmentRequest, CoverRequest, Device, PayrollFeedback, ShiftAssignment, User } from "@/lib/models";
import { localDate } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { SignOutButton } from "@/components/user/AuthButtons";
import { adminLogout } from "../actions/auth";
import AdminNav from "./AdminNav";
import SectionTabs from "./SectionTabs";
import AskAiPanel from "./AskAiPanel";
import { aiAllowed, aiRemaining } from "@/lib/ai";
import { can } from "@/lib/permissions";
import { geminiConfigured } from "@/lib/ocr";
import { goodsEnabled } from "@/lib/goods-server";

// các nút AI (Hỏi AI, Trợ lý, Giải thích lương, Gợi ý số người) gọi Gemini 1–2 lần → cho server chạy tối đa 60 giây
export const maxDuration = 60;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  const [approvals, devices, adj, fb, shiftRequests, covers] = await Promise.all([
    User.countDocuments({ status: "PENDING" }),
    Device.countDocuments({ status: "PENDING", userId: { $in: await User.find({ status: "ACTIVE" }).distinct("_id") } }),
    AdjustmentRequest.countDocuments({ status: "PENDING" }),
    PayrollFeedback.countDocuments({ status: "OPEN" }),
    ShiftAssignment.countDocuments({ status: "PENDING", date: { $gte: localDate(new Date()) } }),
    CoverRequest.countDocuments({ status: "PENDING" }),
  ]);
  const ask = await aiRemaining("ask", `admin:${admin.accountId ?? "owner"}`).catch(() => ({ enabled: false, left: 0, limit: 0 }));
  // nút 📷 trong Hỏi AI: kiểm tra / nhập bill – cần quyền Bill + được dùng "Đọc bill"
  const billOk = can(admin, "finance.bills") && (await aiAllowed("billOcr", `admin:${admin.accountId ?? "owner"}`).catch(() => false));
  const nav = {
    owner: admin.kind === "OWNER",
    perms: [...(admin.perms ?? [])],
    hide: (await goodsEnabled()) ? [] : ["/admin/goods"],
    counts: { approvals, devices, requests: adj + fb + covers, shiftRequests },
  };
  return (
    <div className="min-h-screen lg:flex">
      <aside className="bg-secondary-dark lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-center gap-2 p-3">
          <Logo size={36} />
          <div className="text-white">
            <p className="text-sm font-bold leading-tight">Tiệm Bơ Sầu</p>
            <p className="text-xs opacity-80">Quản lý chấm công</p>
          </div>
        </div>
        <AdminNav {...nav} />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end gap-2 border-b border-[#f1e6c8] bg-white px-4 py-2 text-sm">
          {ask.enabled && geminiConfigured() && <AskAiPanel left={Number.isFinite(ask.left) ? ask.left : null} limit={ask.limit} billOk={billOk} />}
          <span className="text-ink/70">
            {admin.kind === "OWNER" ? "👑 Admin Tổng" : "Admin"}: <b>{admin.kind === "OWNER" ? admin.email : `${admin.name} (${admin.email})`}</b>
          </span>
          {admin.kind === "OWNER" ? (
            <SignOutButton callbackUrl="/admin/login" />
          ) : (
            <form action={adminLogout}>
              <Button variant="ghost" type="submit">Đăng xuất</Button>
            </form>
          )}
        </header>
        <main className="space-y-4 p-4 lg:p-6">
          <SectionTabs {...nav} />
          {children}
        </main>
      </div>
    </div>
  );
}
