"use client";
import { useEffect, useState } from "react";
import { useSafeAction } from "@/components/useSafeAction";
import { Pencil, X } from "lucide-react";
import { Alert, Button, Field, Input, Textarea } from "@/components/ui";
import { editAttendance } from "../../actions/ops";
import TimeInput from "@/components/TimeInput";

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
  extraHours = 0,
}: {
  id: string;
  date: string;
  inTime: string;
  outTime: string;
  missingOut: boolean;
  /** giờ cộng thêm đang có (0 / 0,5) */
  extraHours?: number;
}) {
  const [open, setOpen] = useState(false);
  // lỗi → giữ nguyên giờ đã nhập; thành công → đóng + reset
  const { state, pending, formRef, onSubmit } = useSafeAction(editAttendance, null);

  useEffect(() => {
    if (state?.ok) setOpen(false);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-shade/40 p-4" onClick={() => setOpen(false)}>
        <div className="w-full max-w-xs rounded-2xl bg-card p-4 text-left text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-accent">Sửa giờ chấm công</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng"><X size={16} /></button>
          </div>
          <form ref={formRef} onSubmit={onSubmit} className="space-y-2">
            <input type="hidden" name="id" value={id} />
            <Field label="Ngày"><Input type="date" name="date" defaultValue={date} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Giờ vào"><TimeInput seconds name="inTime" defaultValue={inTime} required /></Field>
              <Field label="Giờ ra"><TimeInput seconds name="outTime" defaultValue={outTime} autoFocus={missingOut} /></Field>
            </div>
            <p className="text-[11px] text-ink/60">Giờ ra nhỏ hơn giờ vào = ca qua đêm (tự cộng sang ngày hôm sau).</p>
            <label className="flex items-center gap-2 rounded-lg bg-primary-light px-2 py-1.5 text-sm font-semibold">
              <input type="checkbox" name="plusHalf" defaultChecked={extraHours > 0} className="h-4 w-4 accent-secondary" />
              +0,5h cho ca này
              <span className="text-[11px] font-normal text-ink/60">(cộng vào giờ tính công)</span>
            </label>
            <Field label="Ghi chú" hint="Không bắt buộc · nhân viên xem được ở Lịch sử chấm công"><Textarea name="note" rows={2} placeholder="VD: Quên check-out, đã sửa giờ ra 22:00" /></Field>
            {state?.error && <Alert tone="red">{state.error}</Alert>}
            <Button type="submit" disabled={pending} className="w-full">{pending ? "Đang lưu…" : "Lưu"}</Button>
          </form>
        </div>
        </div>
      )}
    </div>
  );
}
