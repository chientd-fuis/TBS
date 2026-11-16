"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { AnnItem } from "@/lib/announcements";
import { markAnnouncementsSeen } from "@/app/announce-actions";

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** chữ trên nền màu ảnh: nền tối → chữ trắng */
const darkBg = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l < 0.55;
};

/** Hình minh hoạ mặc định (không tải ảnh): hộp quà + tia sáng */
function DefaultArt({ dark }: { dark: boolean }) {
  const ink = dark ? "#ffffff" : "#542424";
  return (
    <svg width="132" height="116" viewBox="0 0 132 116" aria-hidden className="relative">
      <rect x="28" y="46" width="76" height="58" rx="10" fill="#ffffff" stroke={ink} strokeWidth="4" />
      <rect x="22" y="32" width="88" height="20" rx="8" fill="#ffffff" stroke={ink} strokeWidth="4" />
      <path d="M66 32v72" stroke="#783c3c" strokeWidth="10" />
      <path d="M66 32c-10-16-30-14-26-2 2 6 14 4 26 2zM66 32c10-16 30-14 26-2-2 6-14 4-26 2z" fill="#ffffff" stroke={ink} strokeWidth="4" strokeLinejoin="round" />
      <path d="M14 18l6 4M118 18l-6 4M10 52h8M114 52h8" stroke={ink} strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** 1 thẻ giới thiệu (dùng cho popup, trang Có gì mới, xem trước ở admin) */
export function AnnSlide({ a, compact = false }: { a: AnnItem; compact?: boolean }) {
  const dark = darkBg(a.color);
  return (
    <div>
      <div className={`relative flex items-center justify-center overflow-hidden ${compact ? "h-28" : "h-[190px]"}`} style={{ background: a.color }}>
        {a.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.image} alt="" className="h-full w-full object-cover" />
        ) : (
          <>
            <span aria-hidden className="absolute -top-16 -left-14 h-56 w-56 rounded-full bg-white/25" />
            <span aria-hidden className="absolute -right-10 -bottom-20 h-44 w-44 rounded-full bg-black/10" />
            <DefaultArt dark={dark} />
          </>
        )}
      </div>
      <div className={compact ? "space-y-1.5 p-3" : "space-y-3 px-5 pt-5"}>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-extrabold tracking-wide text-on-accent">MỚI</span>
          <span className="text-xs text-ink/60">Cập nhật {dm(a.date)}</span>
        </div>
        <h2 className={`font-extrabold leading-tight text-ink ${compact ? "text-sm" : "text-[21px]"}`}>{a.title}</h2>
        {a.desc && <p className={`leading-relaxed text-ink/80 ${compact ? "line-clamp-3 text-[11px]" : "text-sm"}`}>{a.desc}</p>}
        {!compact && a.points.length > 0 && (
          <ol className="space-y-2 text-sm">
            {a.points.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[10px] bg-primary-light text-[13px] font-extrabold text-accent">{i + 1}</span>
                <span className="pt-1">{p}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * Popup "Có gì mới": 1 bản → thẻ đơn; 2+ bản → slide (Tiếp / Trước / chấm / vuốt, Bỏ qua tất cả).
 * Đóng bằng bất kỳ nút nào → ghi đã xem tất cả bản đang hiện (theo tài khoản) → không hiện lại.
 */
export default function WhatsNew({ items, as, helpHref }: { items: AnnItem[]; as: "user" | "admin"; helpHref?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(items.length > 0);
  const [i, setI] = useState(0);
  const [, start] = useTransition();
  const touch = useRef<number | null>(null);
  const many = items.length > 1;
  const a = items[i];
  const last = i === items.length - 1;

  // mở popup: khoá cuộn trang phía sau, Esc để đóng
  useEffect(() => {
    if (!open) return;
    const o = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = o;
    };
  }, [open]);

  const close = (action: string, go?: string) => {
    setOpen(false);
    start(async () => {
      await markAnnouncementsSeen(as, items.map((x) => ({ id: x.id, version: x.version })), action).catch(() => null);
    });
    if (go) router.push(go);
  };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close("close");
      if (e.key === "ArrowRight") setI((v) => Math.min(items.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, items.length]);

  if (!open || !a) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-shade/55 p-5 animate-[tbs-toast_.2s_ease-out]" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Có gì mới"
        className="relative max-h-[92dvh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-[28px] bg-card text-ink shadow-2xl"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null || !many) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (dx < -50) setI((v) => Math.min(items.length - 1, v + 1));
          if (dx > 50) setI((v) => Math.max(0, v - 1));
        }}
      >
        <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2">
          {many ? <span className="rounded-full bg-white/90 px-2.5 py-1 text-xs font-bold text-[#542424]">{items.length} bản cập nhật mới</span> : <span />}
          {many ? (
            <button type="button" onClick={() => close("skip")} className="h-8 rounded-full bg-white/90 px-3 text-[13px] font-semibold text-[#542424]">
              Bỏ qua tất cả
            </button>
          ) : (
            <button type="button" aria-label="Đóng" onClick={() => close("close")} className="grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[#542424]">
              <X size={18} />
            </button>
          )}
        </div>

        <div key={a.id} className="animate-[tbs-toast_.2s_ease-out]">
          <AnnSlide a={a} />
        </div>

        <div className="space-y-3 px-5 pt-4 pb-5">
          {many && (
            <div className="flex justify-center gap-1.5" aria-label="Vị trí slide">
              {items.map((x, k) => (
                <button
                  key={x.id}
                  type="button"
                  aria-label={`Bản ${k + 1}`}
                  aria-current={k === i}
                  onClick={() => setI(k)}
                  className={`h-2 rounded-full transition-all ${k === i ? "w-6 bg-accent" : "w-2 bg-line-strong"}`}
                />
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {many && i > 0 && (
              <button type="button" onClick={() => setI(i - 1)} className="h-[50px] rounded-2xl px-4 font-bold text-accent ring-1 ring-line-strong">
                ‹ Trước
              </button>
            )}
            {many && !last ? (
              <button type="button" onClick={() => setI(i + 1)} className="h-[50px] flex-1 rounded-2xl border border-primary-dark bg-primary text-base font-extrabold text-on-primary">
                Tiếp ({i + 1}/{items.length})
              </button>
            ) : a.ctaHref ? (
              <button type="button" onClick={() => close("try", a.ctaHref)} className="h-[50px] flex-1 rounded-2xl border border-primary-dark bg-primary text-base font-extrabold text-on-primary">
                Thử ngay
              </button>
            ) : (
              <button type="button" onClick={() => close("ok")} className="h-[50px] flex-1 rounded-2xl border border-primary-dark bg-primary text-base font-extrabold text-on-primary">
                {many ? "Bắt đầu dùng" : "Đã hiểu"}
              </button>
            )}
          </div>
          {(!many || last) && a.ctaHref && (
            <button type="button" onClick={() => close("ok")} className="h-11 w-full rounded-xl text-[15px] font-semibold text-accent">
              {many ? "Bắt đầu dùng" : "Đã hiểu"}
            </button>
          )}
          {many && !last && a.ctaHref && (
            <button type="button" onClick={() => close("try", a.ctaHref)} className="w-full text-center text-[13px] font-semibold text-accent underline">
              Thử “{a.title}” ngay
            </button>
          )}
          {helpHref && (
            <p className="text-center text-xs text-ink/55">
              {many ? "Vuốt trái / phải để xem · " : ""}Xem lại ở <b>Trợ giúp → Có gì mới</b>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
