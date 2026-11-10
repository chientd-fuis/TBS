"use client";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type State = { ok?: boolean; error?: string } | null;

/**
 * Form gọi server action, hiển thị lỗi / thành công.
 * `confirm`: hỏi lại bằng hộp thoại của app (không dùng window.confirm – trình duyệt có thể đã chặn hộp thoại
 * của trang → confirm() trả false ngay, form im lặng không làm gì).
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Lưu",
  successText = "Đã lưu",
  className,
  variant = "primary",
  confirm,
  buttonClassName,
}: {
  action: (s: State, fd: FormData) => Promise<State>;
  children?: ReactNode;
  submitLabel?: ReactNode;
  successText?: string;
  className?: string;
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  confirm?: string;
  /** class thêm cho nút gửi (VD w-full để các nút cùng cột rộng bằng nhau) */
  buttonClassName?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  const [asking, setAsking] = useState(false);
  return (
    <form
      ref={formRef}
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        if (confirm && !confirmed.current) {
          e.preventDefault();
          setAsking(true);
          return;
        }
        confirmed.current = false;
      }}
    >
      {children}
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && successText && <Alert tone="green">{successText}</Alert>}
      <Button type="submit" variant={variant} disabled={pending} className={buttonClassName}>
        {pending ? "Đang xử lý…" : submitLabel}
      </Button>
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm}
          danger={variant === "danger"}
          confirmLabel={typeof submitLabel === "string" ? submitLabel : "Xác nhận"}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            confirmed.current = true;
            formRef.current?.requestSubmit();
          }}
        />
      )}
    </form>
  );
}
