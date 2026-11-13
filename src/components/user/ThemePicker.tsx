"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/format";
import { THEME_ROOT_ID, THEMES, themeClass, themeHeaderColor, type ThemeId } from "@/lib/themes";
import { setMyTheme } from "@/app/(user)/actions";

function applyTheme(id: ThemeId) {
  const el = document.getElementById(THEME_ROOT_ID);
  if (el) {
    for (const c of [...el.classList]) if (c.startsWith("theme-")) el.classList.remove(c);
    const cls = themeClass(id);
    if (cls) el.classList.add(cls);
  }
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", themeHeaderColor(id)));
}

/** Tài khoản → Màu giao diện: chạm 1 ô là đổi ngay + lưu theo tài khoản. Thử việc: khoá (luôn màu tím). */
export default function ThemePicker({ current, locked }: { current: ThemeId; locked: boolean }) {
  const router = useRouter();
  const [sel, setSel] = useState<ThemeId>(current);
  const [saving, setSaving] = useState<ThemeId | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  const pick = (id: ThemeId) => {
    if (locked || id === sel) return;
    const prev = sel;
    setSel(id);
    setError("");
    applyTheme(id);
    setSaving(id);
    startTransition(async () => {
      const r: { ok?: boolean; error?: string } = await setMyTheme(id).catch(() => ({ error: "Mất kết nối mạng – chưa lưu được màu, thử lại." }));
      setSaving(null);
      if (r?.ok) router.refresh();
      else {
        setSel(prev);
        applyTheme(prev);
        setError(r?.error || "Chưa lưu được màu – thử lại");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink/70">Chạm để đổi – áp dụng ngay, lưu theo tài khoản (đổi điện thoại vẫn giữ).</p>
      {locked && (
        <p className="rounded-xl bg-violet-bg px-3 py-2.5 text-[13px] leading-relaxed text-violet-fg">
          Bạn đang <b>thử việc</b> – app dùng màu tím thử việc. Lên nhân viên chính thức là chọn được màu.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2.5">
        {THEMES.map((t) => {
          const on = !locked && t.id === sel;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t.id)}
              disabled={locked}
              aria-pressed={on}
              className={cn(
                "relative flex flex-col gap-1.5 rounded-2xl border-2 bg-card p-1.5 text-center transition active:scale-[.97] disabled:opacity-45",
                on ? "border-accent" : "border-line",
              )}
            >
              {/* xem trước: thanh đầu trang + 2 nút (chính / phụ) trên nền theme */}
              <span className="flex h-[62px] flex-col overflow-hidden rounded-[10px] ring-1 ring-black/10" style={{ background: t.cream }}>
                <span className="h-4" style={{ background: t.header }} />
                <span className="flex flex-1 items-center justify-center gap-1.5">
                  <span className="h-3.5 w-8 rounded-[5px]" style={{ background: t.primary }} />
                  <span className="h-3.5 w-6 rounded-[5px]" style={{ background: t.secondary }} />
                </span>
              </span>
              <span className="flex min-h-7 items-center justify-center text-xs font-semibold leading-tight">{t.name}</span>
              {on && (
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-on-accent ring-2 ring-card">
                  {saving === t.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={14} strokeWidth={3} aria-hidden />}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-[13px] text-bad-fg ring-1 ring-bad-line">
          {error}
        </p>
      )}
    </div>
  );
}
