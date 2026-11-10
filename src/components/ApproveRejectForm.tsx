"use client";
import { useActionState, useRef, type ReactNode } from "react";
import { Alert, Button, Input } from "@/components/ui";

type State = { ok?: boolean; error?: string } | null;

/**
 * Duyệt / từ chối dùng chung 1 ô ghi chú: gửi `op` = approve | reject và `reply` (ghi chú khi duyệt, lý do khi từ chối).
 * children: ô phụ đứng trước (VD giờ vào / ra khi duyệt chấm công bù), hidden id…
 */
export function ApproveRejectForm({
  action,
  approveLabel = "Duyệt",
  placeholder = "Ghi chú / lý do từ chối (tuỳ chọn)",
  children,
}: {
  action: (s: State, fd: FormData) => Promise<State>;
  approveLabel?: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const op = useRef<HTMLInputElement>(null);
  const pick = (v: string) => () => {
    if (op.current) op.current.value = v;
  };
  return (
    <form action={formAction} className="mt-2 max-w-xl space-y-2">
      <input ref={op} type="hidden" name="op" defaultValue="approve" />
      {children}
      <Input name="reply" placeholder={placeholder} maxLength={200} />
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" disabled={pending} onClick={pick("approve")} className="flex-1 whitespace-nowrap sm:flex-none sm:px-5">
          {pending ? "Đang xử lý…" : approveLabel}
        </Button>
        <Button type="submit" variant="outline" disabled={pending} onClick={pick("reject")} className="flex-1 whitespace-nowrap sm:flex-none sm:px-5">
          Từ chối
        </Button>
      </div>
      {state?.error && <Alert tone="red">{state.error}</Alert>}
    </form>
  );
}
