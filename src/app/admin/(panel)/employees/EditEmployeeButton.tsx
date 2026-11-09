"use client";
import { useActionState, useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { quickEditEmployee } from "../../actions/people";

/** Nút "Sửa" ở danh sách nhân viên → popup sửa họ tên + lương giờ. */
export default function EditEmployeeButton({ id, name, hourlyWage, today }: { id: string; name: string; hourlyWage: number; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(quickEditEmployee, null);
  const [wage, setWage] = useState(String(hourlyWage || ""));
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  const changed = Number(wage.replace(/[^\d]/g, "")) !== hourlyWage;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setWage(String(hourlyWage || ""));
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-accent hover:bg-primary-light"
      >
        <Pencil size={13} /> Sửa
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 text-left text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-bold text-accent">Sửa nhân viên</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">
                <X size={16} />
              </button>
            </div>
            <form action={action} className="space-y-3">
              <input type="hidden" name="userId" value={id} />
              <Field label="Họ tên">
                <Input name="name" defaultValue={name} required autoFocus />
              </Field>
              <Field label="Lương giờ (VND)">
                <Input name="hourlyWage" inputMode="numeric" value={wage} onChange={(e) => setWage(e.target.value)} required className="text-right" />
              </Field>
              {changed && (
                <Field label="Lương mới áp dụng từ ngày" hint="Chọn ngày 01 của tháng nếu muốn tính lương mới cho cả tháng đó">
                  <Input type="date" name="effectiveFrom" defaultValue={today} required />
                </Field>
              )}
              {state?.error && <Alert tone="red">{state.error}</Alert>}
              <Button type="submit" disabled={pending} className="w-full">
                {pending ? "Đang lưu…" : "Lưu"}
              </Button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
