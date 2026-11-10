"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui";

/** Hộp thoại xác nhận (thay cho window.confirm) – Esc / bấm nền để huỷ. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = "Xác nhận",
  cancelLabel = "Huỷ",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);
  if (!open || typeof document === "undefined") return null;
  // Portal ra <body>: hộp thoại hay nằm trong ô bảng (whitespace-nowrap, text-right, overflow…) → không kế thừa style đó.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 text-left whitespace-normal" onClick={() => !busy && onCancel()}>
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="flex items-start gap-2 text-base font-bold text-accent">
          {danger && <TriangleAlert size={18} className="mt-0.5 shrink-0 text-danger" />}
          <span className="min-w-0 break-words">{title}</span>
        </h3>
        {children && <div className="mt-3 space-y-2 text-sm">{children}</div>}
        <div className="mt-5 flex justify-end gap-2">
          {/* type="button": hộp thoại có thể nằm trong <form> (ActionForm) – không được tự submit */}
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>{cancelLabel}</Button>
          <Button type="button" variant={danger ? "danger" : "secondary"} disabled={busy} onClick={onConfirm}>
            {busy && <Loader2 size={16} className="animate-spin" />} {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
