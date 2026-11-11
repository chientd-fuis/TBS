"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Kéo xuống khi đang ở đầu trang → thả ra để tải lại (giống app điện thoại).
 * Chỉ chạy trên cảm ứng. Bỏ qua khi chạm trong popup / thanh cố định (position: fixed) hoặc
 * trong khung cuộn chưa lên đầu, để không mất dữ liệu đang nhập trong popup.
 */
const TRIGGER = 70; // px (sau giảm chấn) cần kéo để tải lại
const MAX = 110;

function blocked(el: EventTarget | null) {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.dataset?.noPtr != null) return true;
    if (n.scrollTop > 0) return true; // khung cuộn bên trong chưa lên đầu
    if (getComputedStyle(n).position === "fixed") return true; // popup, thanh điều hướng
  }
  return false;
}

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [loading, setLoading] = useState(false);
  const st = useRef<{ y: number; on: boolean; pull: number }>({ y: 0, on: false, pull: 0 });

  useEffect(() => {
    const set = (v: number) => {
      st.current.pull = v;
      setPull(v);
    };
    const start = (e: TouchEvent) => {
      st.current.on = e.touches.length === 1 && window.scrollY <= 0 && !blocked(e.target);
      st.current.y = e.touches[0]?.clientY ?? 0;
    };
    const move = (e: TouchEvent) => {
      if (!st.current.on) return;
      if (e.touches.length !== 1 || window.scrollY > 0) {
        st.current.on = false;
        return set(0);
      }
      const dy = e.touches[0].clientY - st.current.y;
      if (dy <= 0) return set(0);
      set(Math.min(MAX, dy * 0.45)); // giảm chấn: phải vuốt mạnh mới đủ
    };
    const end = () => {
      if (!st.current.on) return;
      st.current.on = false;
      if (st.current.pull >= TRIGGER) {
        setLoading(true);
        set(TRIGGER);
        window.location.reload();
      } else set(0);
    };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    };
  }, []);

  if (!pull && !loading) return null;
  const ready = pull >= TRIGGER;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex justify-center"
      style={{ transform: `translateY(${pull - 40}px)`, transition: st.current.on ? "none" : "transform .2s" }}
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full text-ink shadow-md ${ready || loading ? "bg-primary" : "bg-white"}`}
        style={{ opacity: Math.min(1, pull / 40) }}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={loading ? "animate-spin" : ""}
          style={loading ? undefined : { transform: `rotate(${(pull / TRIGGER) * 270}deg)` }}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </div>
    </div>
  );
}
