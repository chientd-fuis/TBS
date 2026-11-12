"use client";
import { useRef, useState, type ReactNode } from "react";
import { Alert, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSafeAction } from "@/components/useSafeAction";

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
  // lỗi → giữ nguyên dữ liệu đã nhập (không để React tự xoá form); thành công → reset như cũ
  const { state, pending, formRef, submit } = useSafeAction(action, null);
  const confirmed = useRef(false);
  const [asking, setAsking] = useState(false);
  return (
    <form
      ref={formRef}
      className={className ?? "space-y-3"}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !confirmed.current) {
          setAsking(true);
          return;
        }
        confirmed.current = false;
        submit(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      }}
    >
      {children}
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && successText && <Alert tone="green">{successText}</Alert>}
      <Button type="submit" variant={variant} loading={pending} loadingText="Đang xử lý…" className={buttonClassName}>
        {submitLabel}
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
