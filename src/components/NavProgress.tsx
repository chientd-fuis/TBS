"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const START = "tbs:nav-start";
const BUSY = "tbs:busy";

/** Gọi trước router.push / replace ở nơi chuyển trang bằng code (không qua thẻ <a>) để hiện loading. */
export function startNavProgress() {
  window.dispatchEvent(new Event(START));
}

/** Bọc 1 lời gọi API (không phải bấm nút) → vạch loading trên header chạy tới khi xong. Thường không cần gọi tay: xem installFetchWatch. */
export function trackBusy<T>(p: Promise<T>): Promise<T> {
  window.dispatchEvent(new CustomEvent(BUSY, { detail: 1 }));
  const end = () => window.dispatchEvent(new CustomEvent(BUSY, { detail: -1 }));
  p.then(end, end);
  return p;
}

const isPrefetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  return h.has("next-router-prefetch") || h.get("purpose") === "prefetch";
};

/**
 * Tự bật vạch loading cho lời gọi API do thao tác KHÔNG PHẢI NÚT gây ra: đổi ô chọn, tích ô, gõ Enter / gõ chữ
 * (lọc, tự lưu), chạm vùng bấm được không phải nút… (server action, router.refresh, fetch đều đi qua fetch).
 *  - Nút / link đã có loading riêng (vòng xoay trong nút, vạch chuyển trang) → bỏ qua nếu thao tác gần nhất là nút / link.
 *  - Chỉ tính request bắt đầu trong 1,5 giây sau thao tác (request ngầm khi tải trang không tính); bỏ qua prefetch của Next.
 *  - Vùng có data-no-busy: không chạy vạch.
 */
function installFetchWatch() {
  const w = window as Window & { __tbsFetchWatch?: boolean };
  if (w.__tbsFetchWatch) return;
  w.__tbsFetchWatch = true;
  let last = { t: 0, button: true };
  const mark = (e: Event) => {
    const el = e.target instanceof Element ? e.target : null;
    last = { t: Date.now(), button: !!el?.closest('button, a[href], [role="button"], input[type="submit"], input[type="button"], [data-no-busy]') };
  };
  for (const ev of ["pointerdown", "keydown", "change"]) document.addEventListener(ev, mark, true);
  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const p = orig(input, init);
    return !last.button && Date.now() - last.t < 1500 && !isPrefetch(input, init) ? trackBusy(p) : p;
  };
}

/**
 * Vạch tiến trình: chạy dọc MÉP DƯỚI header – đặt component trong header (sticky / relative).
 *  1. Chuyển trang: Next.js App Router không có sự kiện chuyển trang → bắt click vào <a> cùng domain
 *     (+ startNavProgress() cho chuyển trang bằng code), kết thúc khi đường dẫn / query đổi.
 *  2. Gọi API không qua nút (installFetchWatch / trackBusy): chạy tới khi các request xong.
 * mobileOnly (trang admin): vạch CHUYỂN TRANG chỉ hiện trên điện thoại (máy tính đã có vòng xoay ở menu);
 * vạch GỌI API vẫn hiện cả trên máy tính.
 * Link nằm trong vùng có data-no-navbar (VD menu admin – đã có vòng xoay tại mục bấm) → không chạy vạch.
 */
export default function NavProgress({ mobileOnly = false }: { mobileOnly?: boolean }) {
  const path = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "go" | "done">("idle");
  const [onlyBusy, setOnlyBusy] = useState(false);
  const nav = useRef(false); // đang chuyển trang
  const busy = useRef(0); // số request (không phải nút) đang chạy
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  // chỉ đọc ref + gọi setState (ổn định) → giữ nguyên 1 hàm suốt vòng đời
  const sync = useRef(() => {
    if (nav.current || busy.current > 0) {
      setOnlyBusy(!nav.current);
      setState("go");
    } else setState((s) => (s === "go" ? "done" : s));
  });

  useEffect(() => {
    installFetchWatch();
    const go = () => {
      clear();
      nav.current = true;
      sync.current();
      // an toàn: mạng treo / trang không đổi → tự tắt sau 15 giây
      timers.current.push(
        window.setTimeout(() => {
          nav.current = false;
          sync.current();
        }, 15_000),
      );
    };
    const onBusy = (e: Event) => {
      busy.current = Math.max(0, busy.current + ((e as CustomEvent<number>).detail || 0));
      sync.current();
    };
    // Nghe ở pha CAPTURE (trước React): <Link> của Next luôn preventDefault() trong onClick của nó (để tự chuyển trang),
    // nghe ở pha bubble sẽ thấy defaultPrevented = true và bỏ qua mọi lần bấm link → vạch không bao giờ chạy.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.getAttribute("href") || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return; // cùng trang (#hash)
      if (a.closest("[data-no-navbar]")) return; // menu admin: loading riêng tại mục bấm
      go();
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener(START, go);
    window.addEventListener(BUSY, onBusy);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener(START, go);
      window.removeEventListener(BUSY, onBusy);
      clear();
    };
  }, []);

  // trang mới đã hiện → hết phần chuyển trang (còn request đang chạy thì vạch chạy tiếp)
  useEffect(() => {
    nav.current = false;
    sync.current();
  }, [path, search]);
  // xong hết → chạy nốt tới 100% rồi mờ dần
  useEffect(() => {
    if (state !== "done") return;
    const t = window.setTimeout(() => setState("idle"), 450);
    return () => window.clearTimeout(t);
  }, [state]);

  if (state === "idle") return null;
  return <span aria-hidden className={`tbs-navbar ${state === "done" ? "tbs-navbar-done" : ""} ${mobileOnly && !onlyBusy ? "lg:hidden" : ""}`} />;
}
