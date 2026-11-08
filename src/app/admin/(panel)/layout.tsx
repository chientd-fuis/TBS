import { requireAdmin } from "@/lib/guards";
import { AdjustmentRequest, CoverRequest, Device, PayrollFeedback, ShiftAssignment, User } from "@/lib/models";
import { localDate } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui";
import { SignOutButton } from "@/components/user/AuthButtons";
import { adminLogout } from "../actions/auth";
import AdminNav from "./AdminNav";

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
        <AdminNav counts={{ approvals, devices, requests: adj + fb + covers, shiftRequests }} />
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-end gap-2 border-b border-[#f1e6c8] bg-white px-4 py-2 text-sm">
          <span className="text-ink/70">
            {admin.kind === "OWNER" ? "👑 Chủ" : "Admin"}: <b>{admin.kind === "OWNER" ? admin.email : admin.name}</b>
          </span>
          {admin.kind === "OWNER" ? (
            <SignOutButton callbackUrl="/admin/login" />
          ) : (
            <form action={adminLogout}>
              <Button variant="ghost" type="submit">Đăng xuất</Button>
            </form>
          )}
        </header>
        <main className="space-y-4 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
