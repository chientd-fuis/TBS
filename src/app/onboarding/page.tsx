import { redirect } from "next/navigation";
import { getSessionEmail, isOwnerEmail } from "@/lib/auth";
import { getCurrentUser } from "@/lib/guards";
import { Store } from "@/lib/models";
import { Logo } from "@/components/Logo";
import { Alert } from "@/components/ui";
import OnboardingForm from "./OnboardingForm";

export default async function OnboardingPage() {
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  if (isOwnerEmail(email)) redirect("/admin");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status === "PENDING") redirect("/pending");
  if (user.status === "ACTIVE") redirect("/");
  if (user.status === "INACTIVE") redirect("/login?error=inactive");
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  return (
    <main className="mx-auto max-w-md space-y-4 p-4">
      <div className="flex items-center gap-3">
        <Logo size={48} />
        <div>
          <h1 className="text-lg font-bold text-accent">Đăng ký nhân viên</h1>
          <p className="text-xs text-ink/70">{email}</p>
        </div>
      </div>
      {user.status === "REJECTED" && (
        <Alert tone="red">Đăng ký trước đã bị từ chối{user.rejectReason ? `: ${user.rejectReason}` : ""}. Bạn có thể đăng ký lại.</Alert>
      )}
      <OnboardingForm
        stores={stores.map((s) => ({ id: String(s._id), name: s.name }))}
        defaultName={user.name || user.googleName || ""}
      />
    </main>
  );
}
