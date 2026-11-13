import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdjustmentRequest, Attendance, CoverRequest, Device, PayrollFeedback, ProbationRequest, ShiftAssignment, User } from "@/lib/models";
import { localDate } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { SignOutButton } from "@/components/user/AuthButtons";
import { adminLogout } from "../actions/auth";
import AdminNav from "./AdminNav";
import MobileMenu from "./MobileMenu";
import NavProgress from "@/components/NavProgress";
import { Suspense } from "react";
import SectionTabs from "./SectionTabs";
import AskAiPanel from "./AskAiPanel";
import { aiAllowed, aiRemaining } from "@/lib/ai";
import { can } from "@/lib/permissions";
import { geminiConfigured } from "@/lib/ocr";
import { goodsEnabled } from "@/lib/goods-server";
import { userAppBlocked } from "@/lib/auth";
import { after } from "next/server";
import { maybeRunAutoCheckout } from "@/lib/auto-checkout";

// các nút AI (Hỏi AI, Trợ lý, Giải thích lương, Gợi ý số người) gọi Gemini 1–2 lần → cho server chạy tối đa 60 giây
export const maxDuration = 60;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  // chạy ngầm sau khi trả trang: tự check-out ca tối các cơ sở đã bật (tối đa 1 lần / 3 phút)
  after(() => maybeRunAutoCheckout());
  const [approvals, devices, adj, fb, shiftRequests, covers, overtime, probations] = await Promise.all([
    User.countDocuments({ status: "PENDING" }),
    Device.countDocuments({ status: "PENDING", userId: { $in: await User.find({ status: "ACTIVE" }).distinct("_id") } }),
    AdjustmentRequest.countDocuments({ status: "PENDING" }),
    PayrollFeedback.countDocuments({ status: "OPEN" }),
    ShiftAssignment.countDocuments({ status: "PENDING", date: { $gte: localDate(new Date()) } }),
    CoverRequest.countDocuments({ status: "PENDING" }),
    Attendance.countDocuments({ "overtime.status": "PENDING" }), // làm thêm giờ chờ xác nhận
    ProbationRequest.countDocuments({ status: "PENDING" }), // thử việc chờ xác nhận
  ]);
  const ask = await aiRemaining("ask", `admin:${admin.accountId ?? "owner"}`).catch(() => ({ enabled: false, left: 0, limit: 0 }));
  // nút 📷 trong Hỏi AI: kiểm tra / nhập bill – cần quyền Bill + được dùng "Đọc bill"
  const billOk = can(admin, "finance.bills") && (await aiAllowed("billOcr", `admin:${admin.accountId ?? "owner"}`).catch(() => false));
  const nav = {
    owner: admin.kind === "OWNER",
    perms: [...(admin.perms ?? [])],
    hide: (await goodsEnabled()) ? [] : ["/admin/goods"],
    counts: { approvals, devices, requests: adj + fb + covers + overtime + probations, shiftRequests },
  };
  // Admin Tổng cho phép (Cài đặt) + có hồ sơ nhân viên đang làm → nút sang app nhân viên
  const userApp =
    !!admin.email && !(await userAppBlocked(admin.email)) && !!(await User.exists({ email: admin.email.toLowerCase(), status: "ACTIVE" }));
  const userAppLink = userApp && (
    <Link href="/" className="inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-current/30 hover:bg-black/5">
      📱 App nhân viên
    </Link>
  );
  const logout =
    admin.kind === "OWNER" ? (
      <SignOutButton callbackUrl="/admin/login" />
    ) : (
      <form action={adminLogout}>
        <Button variant="ghost" type="submit">Đăng xuất</Button>
      </form>
    );
  return (
    <div className="min-h-screen lg:flex">
      {/* máy tính: menu dọc bên trái · điện thoại: thanh gọn + nút ☰ (MobileMenu) */}
      <aside className="hidden bg-secondary-dark lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <Link href="/admin" className="flex items-center gap-2 p-3" title="Về Tổng quan">
          <Logo size={36} />
          <div className="text-white">
            <p className="text-sm font-bold leading-tight">Tiệm Bơ Sầu</p>
            <p className="text-xs opacity-80">Quản lý cửa hàng</p>
          </div>
        </Link>
        <AdminNav {...nav} />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[52px] items-center gap-2 bg-secondary-dark pr-2 pl-1 text-sm shadow-sm lg:relative lg:h-auto lg:justify-end lg:border-b lg:border-[#f1e6c8] lg:bg-white lg:px-4 lg:py-2 lg:shadow-none tbs-navbar-on-dark">
          {/* loading chuyển trang / lọc (chỉ điện thoại): vạch vàng dưới header. Menu có vòng xoay riêng (data-no-navbar), nút có loading trong nút */}
          <Suspense fallback={null}>
            <NavProgress mobileOnly />
          </Suspense>
          <MobileMenu
            nav={nav}
            account={
              <div className="space-y-2">
                <div className="text-xs leading-snug">
                  <div className="opacity-75">{admin.kind === "OWNER" ? "👑 Admin Tổng" : `Admin: ${admin.name}`}</div>
                  <div className="truncate font-semibold">{admin.email}</div>
                </div>
                {userAppLink && <div className="text-white [&_a]:w-full">{userAppLink}</div>}
                <div className="[&_button]:w-full [&_button]:justify-center [&_button]:bg-white/15 [&_button]:text-white">{logout}</div>
              </div>
            }
          />
          <span className="hidden min-w-0 truncate text-ink/70 lg:inline" title={admin.email}>
            {admin.kind === "OWNER" ? (
              <>👑 Admin Tổng: <b>{admin.email}</b></>
            ) : (
              <>Admin: <b>{admin.name}</b> <b>({admin.email})</b></>
            )}
          </span>
          {ask.enabled && geminiConfigured() && (
            <span className="shrink-0 lg:order-first">
              <AskAiPanel left={Number.isFinite(ask.left) ? ask.left : null} limit={ask.limit} billOk={billOk} />
            </span>
          )}
          {userAppLink && <span className="hidden shrink-0 text-accent lg:inline">{userAppLink}</span>}
          <span className="hidden shrink-0 lg:inline">{logout}</span>
        </header>
        <main className="space-y-4 p-4 lg:p-6">
          <SectionTabs {...nav} />
          {children}
        </main>
      </div>
    </div>
  );
}
