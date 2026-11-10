"use client";
import type { ReactNode } from "react";
import { ColumnToggle } from "@/components/ColumnToggle";

/** Ẩn / hiện cột danh sách nhân viên: "Họ tên" (1) và cột Sửa / Chi tiết (7) luôn hiện. */
const COLS = [
  { n: 2, label: "Email" },
  { n: 3, label: "SĐT" },
  { n: 4, label: "Cơ sở" },
  { n: 5, label: "Lương giờ" },
  { n: 6, label: "Trạng thái" },
] as const;

export default function EmployeeColumns({ children }: { children: ReactNode }) {
  return (
    <ColumnToggle cols={COLS} storageKey="tbs.employees.hiddenCols" keepNote="Họ tên + nút Sửa / Chi tiết luôn hiện" minimalLabel="Chỉ họ tên">
      {children}
    </ColumnToggle>
  );
}
