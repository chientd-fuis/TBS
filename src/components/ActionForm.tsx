"use client";
import { useActionState, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";

type State = { ok?: boolean; error?: string } | null;

/** Form gọi server action, hiển thị lỗi / thành công. */
export function ActionForm({
  action,
  children,
  submitLabel = "Lưu",
  successText = "Đã lưu",
  className,
  variant = "primary",
  confirm,
}: {
  action: (s: State, fd: FormData) => Promise<State>;
  children?: ReactNode;
  submitLabel?: ReactNode;
  successText?: string;
  className?: string;
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost";
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && successText && <Alert tone="green">{successText}</Alert>}
      <Button type="submit" variant={variant} disabled={pending}>
        {pending ? "Đang xử lý…" : submitLabel}
      </Button>
    </form>
  );
}
