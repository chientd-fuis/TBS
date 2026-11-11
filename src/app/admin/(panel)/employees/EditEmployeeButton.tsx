"use client";
import { useActionState, useEffect, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { PAY_TYPES, type PayType } from "@/lib/salary";
import { quickEditEmployee } from "../../actions/people";

const digits = (v: string) => Number(v.replace(/[^\d]/g, ""));

/** Nút "Sửa" ở danh sách nhân viên → popup sửa họ tên + hình thức lương (lương giờ / lương cứng tháng). */
export default function EditEmployeeButton({
  id,
  name,
  hourlyWage,
  payType,
  monthlySalary,
  paidLeaveDays,
  today,
}: {
  id: string;
  name: string;
  hourlyWage: number;
  payType: PayType;
  monthlySalary: number;
  paidLeaveDays: number;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(quickEditEmployee, null);
  const [type, setType] = useState<PayType>(payType);
  const [wage, setWage] = useState(String(hourlyWage || ""));
  const [salary, setSalary] = useState(String(monthlySalary || ""));
  const [leave, setLeave] = useState(String(paidLeaveDays || 0));
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  const fulltime = type === "FULLTIME";
  const termsChanged = type !== payType || (fulltime && (digits(salary) !== monthlySalary || Number(leave.replace(",", ".")) !== paidLeaveDays));
  const changed = termsChanged || (!fulltime && digits(wage) !== hourlyWage);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setType(payType);
          setWage(String(hourlyWage || ""));
          setSalary(String(monthlySalary || ""));
          setLeave(String(paidLeaveDays || 0));
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
              <Field label="Hình thức lương">
                <Select name="payType" value={type} onChange={(e) => setType(e.target.value as PayType)}>
                  {PAY_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </Select>
              </Field>
              {fulltime ? (
                <>
                  <Field label="Lương cứng / tháng (VND)" hint="Vẫn chấm công để theo dõi giờ; lương cơ bản = lương cứng (không nhân giờ)">
                    <Input name="monthlySalary" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} required className="text-right" />
                  </Field>
                  <Field label="Số ngày nghỉ có lương / tháng" hint="Dùng tính tiền nghỉ không lương ở Tạm ứng: lương / (số ngày trong tháng − ngày nghỉ có lương) × ngày nghỉ không lương">
                    <Input name="paidLeaveDays" inputMode="decimal" value={leave} onChange={(e) => setLeave(e.target.value)} className="text-right" />
                  </Field>
                </>
              ) : (
                <Field label="Lương giờ (VND)">
                  <Input name="hourlyWage" inputMode="numeric" value={wage} onChange={(e) => setWage(e.target.value)} required className="text-right" />
                </Field>
              )}
              {changed && (
                <Field
                  label="Áp dụng từ ngày"
                  hint={termsChanged ? "Lương cứng / đổi hình thức lương tính cho CẢ THÁNG của ngày này" : "Chọn ngày 01 của tháng nếu muốn tính lương mới cho cả tháng đó"}
                >
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
