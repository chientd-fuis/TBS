import { requireActiveUser } from "@/lib/guards";
import { Store } from "@/lib/models";
import { Logo } from "@/components/Logo";
import BottomNav from "@/components/user/BottomNav";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).select("name").lean();
  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-primary px-4 py-2 shadow-sm">
        <Logo size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold">{user.name}</p>
          <p className="truncate text-xs">{store?.name}</p>
        </div>
      </header>
      <main className="space-y-4 p-4">{children}</main>
      <BottomNav />
    </div>
  );
}
