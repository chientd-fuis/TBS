"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { editAttendance } from "../../actions/ops";

/**
 * Sửa nhanh giờ vào / giờ ra ngay trên bảng chấm công (spec 7.1).
 * Dùng cả cho "check-out hộ" lượt đang mở / quên check-out: chỉ cần nhập giờ ra.
 */
export default function QuickEdit({
  id,
  date,
  inTime,
  outTime,
  missingOut,
}: {
  id: string;
  date: string;
  inTime: string;
  outTime: string;
  missingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(editAttendance, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      setOpen(false);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold ${missingOut ? "bg-danger text-white" : "text-accent hover:bg-primary-light"}`}
      >
        <Pencil size={12} /> {missingOut ? "Nhập giờ ra" : "Sửa giờ"}
      </button>
      {open && (
        // Hộp thoại cố định giữa màn hình (bảng có thanh cuộn nên không dùng popover tuyệt đối)
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
        <div className="w-full max-w-xs rounded-2xl bg-white p-4 text-left text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-accent">Sửa giờ chấm công</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng"><X size={16} /></button>
          </div>
          <form ref={formRef} action={action} className="space-y-2">
            <input type="hidden" name="id" value={id} />
            <Field label="Ngày"><Input type="date" name="date" defaultValue={date} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Giờ vào"><Input type="time" step={1} name="inTime" defaultValue={inTime} required /></Field>
              <Field label="Giờ ra"><Input type="time" step={1} name="outTime" defaultValue={outTime} autoFocus={missingOut} /></Field>
            </div>
            <p className="text-[11px] text-ink/60">Giờ ra nhỏ hơn giờ vào = ca qua đêm (tự cộng sang ngày hôm sau).</p>
            <Field label="Lý do sửa (bắt buộc)"><Textarea name="reason" rows={2} required placeholder="VD: NV quên check-out, ra về lúc 22:00" /></Field>
            {state?.error && <Alert tone="red">{state.error}</Alert>}
            <Button type="submit" disabled={pending} className="w-full">{pending ? "Đang lưu…" : "Lưu"}</Button>
          </form>
        </div>
        </div>
      )}
    </div>
  );
}
