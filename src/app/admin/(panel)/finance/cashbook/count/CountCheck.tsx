"use client";
import { useState, useTransition } from "react";
import { setCashCount } from "@/app/admin/actions/finance";

/** Ô tích "đã lấy & đếm tiền mặt" – bấm là lưu ngay (Admin Tổng). */
export default function CountCheck({ storeId, date, counted, title }: { storeId: string; date: string; counted: boolean; title?: string }) {
  const [on, setOn] = useState(counted);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5" title={err || title}>
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.checked;
          setOn(v);
          setErr("");
          start(async () => {
            const r = await setCashCount(storeId, date, v);
            if (r?.error) {
              setOn(!v);
              setErr(r.error);
            }
          });
        }}
        className="h-5 w-5 accent-[var(--color-secondary)]"
      />
      {err && <span className="text-xs text-danger">Lỗi</span>}
    </label>
  );
}
