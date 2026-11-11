"use client";
import { useState } from "react";
import { Field, Input, Select } from "@/components/ui";
import { PAY_TYPES, type PayType } from "@/lib/salary";

/**
 * Ô nhập hình thức lương trong form: payType + (lương giờ | lương cứng / tháng).
 * hourly=false → không có ô lương giờ (VD trang Chi tiết đã có card lương giờ riêng).
 */
export function PayTermsFields({
  defaultType = "HOURLY",
  defaultSalary,
  defaultLeave,
  hourly = true,
  month,
}: {
  defaultType?: PayType;
  defaultSalary?: number;
  defaultLeave?: number;
  hourly?: boolean;
  /** có → hiện ô "Áp dụng từ tháng" (YYYY-MM) */
  month?: string;
}) {
  const [type, setType] = useState<PayType>(defaultType);
  return (
    <>
      <Field label="Hình thức lương">
        <Select name="payType" value={type} onChange={(e) => setType(e.target.value as PayType)} className="!w-56">
          {PAY_TYPES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>
      </Field>
      {type === "FULLTIME" ? (
        <>
          <Field label="Lương cứng / tháng (VND)">
            <Input name="monthlySalary" inputMode="numeric" required defaultValue={defaultSalary || ""} placeholder="VD 8000000" className="!w-36 text-right" />
          </Field>
          <Field label="Ngày nghỉ có lương / tháng">
            <Input name="paidLeaveDays" inputMode="decimal" defaultValue={defaultLeave ?? 0} title="Dùng tính tiền nghỉ không lương ở Tạm ứng: lương / (số ngày trong tháng − ngày nghỉ có lương) × ngày nghỉ không lương" className="!w-28 text-right" />
          </Field>
        </>
      ) : (
        hourly && (
          <Field label="Lương giờ (VND)">
            <Input name="hourlyWage" inputMode="numeric" required placeholder="VD 25000" className="!w-32 text-right" />
          </Field>
        )
      )}
      {month && (
        <Field label="Áp dụng từ tháng">
          <Input type="month" name="effectiveMonth" defaultValue={month} required className="!w-40" />
        </Field>
      )}
    </>
  );
}
