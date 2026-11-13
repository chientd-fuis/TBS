"use client";
import type { ReactNode } from "react";
import { ColumnToggle } from "@/components/ColumnToggle";

/** Ẩn / hiện cột bảng lương: cột "Nhân viên" (1) và "Thực nhận" (9) luôn hiện. */
const COLS = [
  { n: 2, label: "Giờ công" },
  { n: 3, label: "Lương giờ / cứng" },
  { n: 4, label: "Lương CB" },
  { n: 5, label: "Phụ cấp" },
  { n: 6, label: "Tạm ứng" },
  { n: 7, label: "Thưởng" },
  { n: 8, label: "Phạt" },
  { n: 10, label: "Chuyển khoản" },
  { n: 11, label: "Trả lương" },
] as const;

/** extra: bộ lọc "Ẩn NV 0đ / đã nghỉ" đặt cùng hàng nút cột */
export default function PayrollColumns({ extra, children }: { extra?: ReactNode; children: ReactNode }) {
  return (
    // "Hiện cột trả lương": chỉ Tên + Thực nhận + Chuyển khoản (đi chuyển khoản trên điện thoại)
    <ColumnToggle cols={COLS} storageKey="tbs.payroll.hiddenCols" keepNote="Tên + Thực nhận luôn hiện" minimalLabel="Hiện cột trả lương" presetShow={[10]} extra={extra}>
      {children}
    </ColumnToggle>
  );
}
