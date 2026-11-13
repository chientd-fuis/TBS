"use client";
import { useRef, useState, type ReactNode } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useSafeAction } from "@/components/useSafeAction";

type State = { ok?: boolean; error?: string } | null;

/**
 * Duyệt / từ chối dùng chung 1 ô ghi chú: gửi `op` = approve | reject và `reply` (ghi chú khi duyệt, lý do khi từ chối).
 * children: ô phụ đứng trước (VD giờ vào / ra khi duyệt chấm công bù), hidden id…
 * rejectConfirm: hỏi lại trước khi từ chối (thao tác nặng, VD "Không nhận" = cho nghỉ việc).
 */
export function ApproveRejectForm({
  action,
  approveLabel = "Duyệt",
  rejectLabel = "Từ chối",
  rejectConfirm,
  placeholder = "Ghi chú / lý do từ chối (tuỳ chọn)",
  children,
}: {
  action: (s: State, fd: FormData) => Promise<State>;
  approveLabel?: string;
  rejectLabel?: string;
  rejectConfirm?: string;
  placeholder?: string;
  children?: ReactNode;
}) {
  // lỗi → giữ nguyên giờ / ghi chú admin đã nhập
  const { state, pending, formRef, onSubmit } = useSafeAction(action, null);
  const op = useRef<HTMLInputElement>(null);
  const [clicked, setClicked] = useState<"approve" | "reject">("approve");
  const [asking, setAsking] = useState(false);
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
        <Button
          type={rejectConfirm ? "button" : "submit"}
          variant="outline"
          disabled={pending}
          loading={pending && clicked === "reject"}
          loadingText="Đang xử lý…"
          onClick={rejectConfirm ? () => setAsking(true) : pick("reject")}
          className="flex-1 whitespace-nowrap sm:flex-none sm:px-5"
        >
          {rejectLabel}
        </Button>
      </div>
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {rejectConfirm && (
        <ConfirmDialog
          open={asking}
          title={rejectConfirm}
          danger
          confirmLabel={rejectLabel}
          onCancel={() => setAsking(false)}
          onConfirm={() => {
            setAsking(false);
            pick("reject")();
            formRef.current?.requestSubmit();
          }}
        />
      )}
    </form>
  );
}
