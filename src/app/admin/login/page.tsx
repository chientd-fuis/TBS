import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-session";
import { getSessionEmail, isOwnerEmail } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { AdminAccount } from "@/lib/models";
import { ensureSeed } from "@/lib/settings";
import { Logo } from "@/components/Logo";
import { Alert, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { GoogleSignIn, SignOutButton } from "@/components/user/AuthButtons";
import { adminEnter } from "../actions/auth";

export const dynamic = "force-dynamic";

/** Đăng nhập trang quản lý bằng Gmail: Admin Tổng (OWNER_EMAIL) hoặc admin được Admin Tổng thêm vào danh sách. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ out?: string; denied?: string }> }) {
  await ensureSeed();
  if (await getAdmin()) redirect("/admin");
  const { out, denied } = await searchParams;
  const email = await getSessionEmail();
  if (email && isOwnerEmail(email)) redirect("/admin");
  await connectDB();
  const acc = email ? await AdminAccount.findOne({ email }).select("name status").lean() : null;
  // admin đã đăng nhập Google → vào thẳng trang quản lý (trừ khi vừa tự bấm Thoát)
  if (acc?.status === "ACTIVE" && !out && !denied) redirect("/api/admin/enter");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-5 p-6">
      <Logo size={110} />
      <h1 className="text-xl font-bold text-accent">Quản lý Tiệm Bơ Sầu</h1>
      {out && <Alert tone="green">Đã thoát trang quản lý.</Alert>}
      {!email ? (
        <Card className="w-full" title="Đăng nhập bằng Gmail">
          <p className="mb-3 text-sm text-ink/70">Dành cho Admin Tổng và admin. Admin dùng Gmail đã được Admin Tổng thêm vào danh sách.</p>
          <GoogleSignIn callbackUrl="/api/admin/enter" />
        </Card>
      ) : (
        <Card className="w-full" title={email}>
          {acc?.status === "ACTIVE" ? (
            <ActionForm action={adminEnter} submitLabel="Vào trang quản lý" successText="">
              <p className="text-sm">
                Xin chào <b>{acc.name}</b>.
              </p>
            </ActionForm>
          ) : acc?.status === "BLOCKED" ? (
            <Alert tone="red">Tài khoản admin này đã bị Admin Tổng khoá.</Alert>
          ) : (
            <Alert tone="yellow">Gmail này chưa có quyền quản lý. Nhờ Admin Tổng thêm Gmail của bạn vào danh sách admin, sau đó tải lại trang này.</Alert>
          )}
          <div className="mt-3 border-t border-line pt-3 text-center">
            <SignOutButton callbackUrl="/admin/login" />
            <p className="mt-1 text-xs text-ink/50">Đăng xuất để dùng Gmail khác</p>
          </div>
        </Card>
      )}
    </main>
  );
}
