"use client";
import type { ReactNode } from "react";
import { ColumnToggle } from "@/components/ColumnToggle";

/** Ẩn / hiện cột bảng lương: cột "Nhân viên" (1) và "Thực nhận" (9) luôn hiện. */
const COLS = [
  { n: 2, label: "Giờ công" },
  { n: 3, label: "Lương giờ" },
  { n: 4, label: "Lương CB" },
  { n: 5, label: "Phụ cấp" },
  { n: 6, label: "Tạm ứng" },
  { n: 7, label: "Thưởng" },
  { n: 8, label: "Phạt" },
  { n: 10, label: "Chuyển khoản" },
  { n: 11, label: "Trả lương" },
] as const;

export default function PayrollColumns({ children }: { children: ReactNode }) {
  return (
    <ColumnToggle cols={COLS} storageKey="tbs.payroll.hiddenCols" keepNote="Tên + Thực nhận luôn hiện" minimalLabel="Chỉ tên + thực nhận">
      {children}
    </ColumnToggle>
  );
}
