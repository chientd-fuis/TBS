import type { Metadata } from "next";
import Link from "next/link";
import { getSettings } from "@/lib/settings";
import { viDateTime } from "@/lib/time";
import Markdown from "@/components/Markdown";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Chính sách quyền riêng tư – Tiệm Bơ Sầu" };

/** Trang công khai (không cần đăng nhập): Chính sách quyền riêng tư Admin Tổng soạn ở Cài đặt → Quyền riêng tư. */
export default async function PrivacyPage() {
  const s = await getSettings();
  const v = s.privacyVersion ?? 0;
  return (
    <div className="mx-auto min-h-screen max-w-lg bg-cream pb-10">
      <header className="sticky top-0 z-10 flex items-center gap-3 bg-header px-4 py-3 text-on-header shadow-sm">
        <Link href="/" className="text-xl leading-none" aria-label="Về app">‹</Link>
        <div>
          <div className="text-base font-bold">Chính sách quyền riêng tư</div>
          {v > 0 && (
            <div className="text-[11px] opacity-85">
              Phiên bản {v}
              {s.privacyPublishedAt ? ` · phát hành ${viDateTime(s.privacyPublishedAt).slice(0, 10)}` : ""}
            </div>
          )}
        </div>
      </header>
      <main className="p-4">
        <div className="rounded-2xl bg-card p-4 ring-1 ring-line">
          {v > 0 ? <Markdown text={s.privacyMd || ""} /> : <p className="py-6 text-center text-sm text-ink/60">Quán chưa phát hành chính sách quyền riêng tư.</p>}
        </div>
      </main>
    </div>
  );
}
