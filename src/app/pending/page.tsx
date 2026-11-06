import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guards";
import { Store } from "@/lib/models";
import { Logo } from "@/components/Logo";
import { Card } from "@/components/ui";
import { SignOutButton } from "@/components/user/AuthButtons";
import PendingDevice from "./PendingDevice";

export default async function PendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "ACTIVE") redirect("/");
  if (user.status !== "PENDING") redirect("/onboarding");
  const store = await Store.findById(user.storeId).lean();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo size={120} />
      <Card className="w-full space-y-2">
        <h1 className="text-lg font-bold text-accent">Đang chờ duyệt</h1>
        <p className="text-sm">
          Bạn đã đăng ký vào <b>{store?.name}</b>. Admin sẽ duyệt tài khoản và thiết bị của bạn sớm.
        </p>
        <PendingDevice />
      </Card>
      <SignOutButton />
    </main>
  );
}
