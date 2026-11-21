"use client";
import { useEffect } from "react";

/** Lỗi trên trình duyệt (màn hình trắng, nút bấm không chạy…) → gửi về Log lỗi hệ thống. Mỗi lần mở trang tối đa 10 lỗi, không gửi trùng. */
const IGNORE = /ResizeObserver loop|^Script error\.?$|chrome-extension:|moz-extension:|safari-extension:/i;

export default function ErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>();
    const send = (message: string, stack?: string) => {
      message = String(message || "").slice(0, 500);
      if (!message || IGNORE.test(message) || IGNORE.test(stack ?? "") || sent.has(message) || sent.size >= 10) return;
      sent.add(message);
      const body = JSON.stringify({ message, stack: stack?.slice(0, 3000), path: location.pathname + location.search });
      try {
        if (!navigator.sendBeacon?.("/api/client-error", new Blob([body], { type: "application/json" })))
          void fetch("/api/client-error", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      } catch {
        /* không gửi được thì thôi */
      }
    };
    const onError = (e: ErrorEvent) => send(e.message || String(e.error), e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}:${e.colno}`);
    const onReject = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      send(r instanceof Error ? r.message : typeof r === "string" ? r : JSON.stringify(r ?? "Promise lỗi"), r instanceof Error ? r.stack : undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);
  return null;
}
