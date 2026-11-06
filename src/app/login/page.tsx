import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionEmail, isOwnerEmail } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Alert, Card } from "@/components/ui";
import { GoogleSignIn, SignOutButton } from "@/components/user/AuthButtons";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const email = await getSessionEmail();
  const { error } = await searchParams;
  // Không tự chuyển trang khi có lỗi (VD tài khoản nghỉ việc) → tránh vòng lặp /login ⇄ /
  if (email && !error) redirect(isOwnerEmail(email) ? "/admin" : "/");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <Logo size={160} />
      <div className="text-center">
        <h1 className="text-2xl font-bold text-accent">Tiệm Bơ Sầu</h1>
        <p className="text-ink/70">Chấm công bằng khuôn mặt</p>
      </div>
      <Card className="w-full space-y-4">
        {error === "inactive" && (
          <Alert tone="red">Tài khoản {email} đã ngừng hoạt động. Liên hệ admin nếu đây là nhầm lẫn.</Alert>
        )}
        {email && error ? (
          <SignOutButton />
        ) : (
          <GoogleSignIn />
        )}
        <p className="text-center text-xs text-ink/60">Lần đầu đăng nhập, bạn sẽ đăng ký vào cơ sở làm việc và chờ admin duyệt.</p>
      </Card>
      <Link href="/admin/login" className="text-sm text-accent underline">
        Đăng nhập trang quản lý
      </Link>
    </main>
  );
}
