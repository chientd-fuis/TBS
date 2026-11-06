import { redirect } from "next/navigation";
import { getAdmin } from "@/lib/admin-session";
import { ensureSeed } from "@/lib/settings";
import { Logo } from "@/components/Logo";
import { Alert, Card, Field, Input } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { GoogleSignIn } from "@/components/user/AuthButtons";
import { adminLogin } from "../actions/auth";

export default async function AdminLoginPage({ searchParams }: { searchParams: Promise<{ changed?: string }> }) {
  await ensureSeed();
  if (await getAdmin()) redirect("/admin");
  const { changed } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-5 p-6">
      <Logo size={110} />
      <h1 className="text-xl font-bold text-accent">Quản lý Tiệm Bơ Sầu</h1>
      {changed && <Alert tone="green">Đã đổi mật khẩu – vui lòng đăng nhập lại bằng mật khẩu mới.</Alert>}
      <Card className="w-full" title="Đăng nhập bằng mật khẩu">
        <ActionForm action={adminLogin} submitLabel="Đăng nhập" successText="">
          <Field label="Mật khẩu admin">
            <Input type="password" name="password" required autoComplete="current-password" />
          </Field>
          <Field label="Tên hiển thị" hint="Ghi vào lịch sử thao tác, VD: Lan – Văn Phú">
            <Input name="displayName" required />
          </Field>
        </ActionForm>
      </Card>
      <Card className="w-full" title="Chủ cửa hàng">
        <GoogleSignIn callbackUrl="/admin" />
      </Card>
    </main>
  );
}
