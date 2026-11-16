import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { publishedFor } from "@/lib/announcements";
import { AnnSlide } from "@/components/WhatsNew";
import { Card } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Trợ giúp → Có gì mới: xem lại mọi bản giới thiệu tính năng đã đăng (mới nhất trước) */
export default async function WhatsNewPage() {
  const user = await requireActiveUser();
  const list = await publishedFor({ kind: "USER", storeId: user.storeId });
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Có gì mới</h1>
        <Link href="/" className="text-sm text-accent underline">← Chấm công</Link>
      </div>
      {!list.length ? (
        <Card>
          <p className="text-sm text-ink/60">Chưa có giới thiệu tính năng nào.</p>
        </Card>
      ) : (
        list.map((a) => (
          <section key={a.id} className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-line">
            <AnnSlide a={a} />
            <div className="px-5 pt-3 pb-5">
              {a.ctaHref && (
                <Link href={a.ctaHref} className="flex h-12 items-center justify-center rounded-2xl border border-primary-dark bg-primary font-extrabold text-on-primary">
                  Thử ngay
                </Link>
              )}
            </div>
          </section>
        ))
      )}
    </>
  );
}
