"use client";
import { useRef, useState, type ReactNode } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { useSafeAction } from "@/components/useSafeAction";

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
  // lỗi → giữ nguyên giờ / ghi chú admin đã nhập
  const { state, pending, formRef, onSubmit } = useSafeAction(action, null);
  const op = useRef<HTMLInputElement>(null);
  const [clicked, setClicked] = useState<"approve" | "reject">("approve");
  const pick = (v: "approve" | "reject") => () => {
    if (op.current) op.current.value = v;
    setClicked(v);
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="mt-2 max-w-xl space-y-2">
      <input ref={op} type="hidden" name="op" defaultValue="approve" />
      {children}
      <Input name="reply" placeholder={placeholder} maxLength={200} />
      <div className="flex gap-2">
        {/* nút vừa bấm hiện vòng xoay, nút còn lại khoá */}
        <Button type="submit" variant="secondary" disabled={pending} loading={pending && clicked === "approve"} loadingText="Đang xử lý…" onClick={pick("approve")} className="flex-1 whitespace-nowrap sm:flex-none sm:px-5">
          {approveLabel}
        </Button>
        <Button type="submit" variant="outline" disabled={pending} loading={pending && clicked === "reject"} loadingText="Đang xử lý…" onClick={pick("reject")} className="flex-1 whitespace-nowrap sm:flex-none sm:px-5">
          Từ chối
        </Button>
      </div>
      {state?.error && <Alert tone="red">{state.error}</Alert>}
    </form>
  );
}
