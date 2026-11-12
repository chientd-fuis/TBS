"use client";
import { useEffect, useState } from "react";
import { useSafeAction } from "@/components/useSafeAction";
import { Loader2, Trash2 } from "lucide-react";
import { Alert, Button, Input } from "@/components/ui";
import { bulkDeleteAttendance } from "../../actions/ops";

/** Ô tích các dòng nằm trong bảng (thuộc form này qua thuộc tính form=…). */
const boxes = (formId: string) => [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"][name="ids"]`)];

/** Chọn tất cả – đặt ở tiêu đề cột. */
export function SelectAllBox({ formId }: { formId: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Chọn tất cả"
      className="h-4 w-4 accent-[#c0392b]"
      onChange={(e) => {
        for (const b of boxes(formId)) b.checked = e.target.checked;
        document.dispatchEvent(new Event("bulk-select"));
      }}
    />
  );
}

/** Thanh xoá hàng loạt: đếm số lượt đã tích, lý do (tuỳ chọn), xác nhận rồi xoá. */
export default function BulkDeleteBar({ formId }: { formId: string }) {
  const { state, pending, submit } = useSafeAction(bulkDeleteAttendance, null, { resetOnOk: false });
  const [n, setN] = useState(0);
  useEffect(() => {
    const count = () => setN(boxes(formId).filter((b) => b.checked).length);
    count();
    document.addEventListener("change", count);
    document.addEventListener("bulk-select", count);
    return () => {
      document.removeEventListener("change", count);
      document.removeEventListener("bulk-select", count);
    };
  }, [formId]);
  // xoá xong → bỏ tích
  useEffect(() => {
    if (state?.ok) {
      for (const b of boxes(formId)) b.checked = false;
      setN(0);
    }
  }, [state, formId]);

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        if (!n || !window.confirm(`Xoá ${n} lượt chấm công đã tích? Không khôi phục được (vẫn lưu trong lịch sử chỉnh sửa).`)) return;
        submit(e.currentTarget);
      }}
      className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-[#fdeaea] p-2 text-sm"
    >
      <span className="font-semibold text-danger">Đã tích {n} lượt</span>
      <Input name="reason" placeholder="Lý do xoá (tuỳ chọn)" className="!w-56 !py-1" />
      <Button type="submit" variant="danger" disabled={!n || pending} className="px-3 py-1.5">
        {pending ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Xoá các lượt đã tích
      </Button>
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && <span className="text-xs text-secondary-dark">Đã xoá</span>}
    </form>
  );
}
