"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const START = "tbs:nav-start";

/** Gọi trước router.push / replace ở nơi chuyển trang bằng code (không qua thẻ <a>) để hiện loading. */
export function startNavProgress() {
  window.dispatchEvent(new Event(START));
}

/**
 * Vạch tiến trình chuyển trang: chạy dọc MÉP DƯỚI header – đặt component trong header (sticky / relative).
 * Next.js App Router không có sự kiện chuyển trang → bắt click vào <a> cùng domain
 * (+ startNavProgress() cho chuyển trang bằng code), kết thúc khi đường dẫn / query đổi.
 * mobileOnly (trang admin): chỉ hiện trên điện thoại / màn nhỏ, máy tính (lg) không hiện loading.
 * Link nằm trong vùng có data-no-navbar (VD menu admin – đã có vòng xoay tại mục bấm) → không chạy vạch.
 */
export default function NavProgress({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const path = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "go" | "done">("idle");
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  useEffect(() => {
    const go = () => {
      clear();
      setState("go");
      // an toàn: mạng treo / trang không đổi → tự tắt sau 15 giây
      timers.current.push(window.setTimeout(() => setState("done"), 15_000));
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.getAttribute("href") || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // cùng trang (#hash)
      if (a.closest("[data-no-navbar]")) return; // menu admin: loading riêng tại mục bấm
      go();
    };
    document.addEventListener("click", onClick);
    window.addEventListener(START, go);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener(START, go);
      clear();
    };
  }, []);

  // trang mới đã hiện → chạy nốt tới 100% rồi mờ dần
  useEffect(() => {
    setState((s) => (s === "go" ? "done" : s));
  }, [path, search]);
  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 450);
    return () => window.clearTimeout(t);
  }, [state]);

  if (state === "idle") return null;
  return <span aria-hidden className={`tbs-navbar ${state === "done" ? "tbs-navbar-done" : ""} ${mobileOnly ? "lg:hidden" : ""}`} />;
}
