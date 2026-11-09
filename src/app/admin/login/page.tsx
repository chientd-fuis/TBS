import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-session";
import { getSessionEmail, isOwnerEmail } from "@/lib/auth";
import { connectDB } from "@/lib/db";
import { AdminAccount } from "@/lib/models";
import { ensureSeed } from "@/lib/settings";
import { Logo } from "@/components/Logo";
import { Alert, Card, Field, Input } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { GoogleSignIn, SignOutButton } from "@/components/user/AuthButtons";
import { adminEnter, adminRequest } from "../actions/auth";

export const dynamic = "force-dynamic";

/** Đăng nhập trang quản lý bằng Gmail: Admin Tổng (OWNER_EMAIL) hoặc admin được Admin Tổng thêm / duyệt. */
export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ out?: string }> }) {
  await ensureSeed();
  if (await getAdmin()) redirect("/admin");
  const { out } = await searchParams;
  const email = await getSessionEmail();
  if (email && isOwnerEmail(email)) redirect("/admin");
  await connectDB();
  const acc = email ? await AdminAccount.findOne({ email }).select("name status").lean() : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-5 p-6">
      <Logo size={110} />
      <h1 className="text-xl font-bold text-accent">Quản lý Tiệm Bơ Sầu</h1>
      {out && <Alert tone="green">Đã thoát trang quản lý.</Alert>}
      {!email ? (
        <Card className="w-full" title="Đăng nhập bằng Gmail">
          <p className="mb-3 text-sm text-ink/70">Dành cho Admin Tổng và admin. Admin dùng Gmail đã được Admin Tổng thêm vào danh sách.</p>
          <GoogleSignIn callbackUrl="/admin/login" />
        </Card>
      ) : (
        <Card className="w-full" title={email}>
          {acc?.status === "ACTIVE" ? (
            <ActionForm action={adminEnter} submitLabel="Vào trang quản lý" successText="">
              <p className="text-sm">
                Xin chào <b>{acc.name}</b>.
              </p>
            </ActionForm>
          ) : acc?.status === "PENDING" ? (
            <Alert tone="yellow">Đã gửi yêu cầu làm admin – chờ Admin Tổng duyệt và phân quyền, sau đó tải lại trang này.</Alert>
          ) : acc?.status === "BLOCKED" ? (
            <Alert tone="red">Tài khoản admin này đã bị Admin Tổng khoá.</Alert>
          ) : (
            <ActionForm action={adminRequest} submitLabel="Gửi yêu cầu làm admin" successText="Đã gửi – chờ Admin Tổng duyệt">
              <p className="text-sm text-ink/70">Gmail này chưa có quyền quản lý. Gửi yêu cầu để Admin Tổng duyệt.</p>
              <Field label="Tên hiển thị" hint="Ghi vào lịch sử thao tác, VD: Lan – Văn Phú">
                <Input name="name" required />
              </Field>
            </ActionForm>
          )}
          <div className="mt-3 border-t border-[#f1e6c8] pt-3 text-center">
            <SignOutButton callbackUrl="/admin/login" />
            <p className="mt-1 text-xs text-ink/50">Đăng xuất để dùng Gmail khác</p>
          </div>
        </Card>
      )}
    </main>
  );
}
