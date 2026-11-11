"use client";
import type { ReactNode } from "react";
import { ColumnToggle } from "@/components/ColumnToggle";

/** Đếm tiền: Ngày (1), Tiền mặt (2), Đã đếm (8) luôn hiện; các cột khác ẩn sẵn. */
const COLS = [
  { n: 3, label: "DT máy" },
  { n: 4, label: "Tài khoản" },
  { n: 5, label: "Chi tiêu" },
  { n: 6, label: "Grab" },
  { n: 7, label: "Shopee" },
] as const;

export default function CountColumns({ children }: { children: ReactNode }) {
  return (
    <ColumnToggle
      cols={COLS}
      storageKey="tbs.cashcount.hiddenCols"
      keepNote="Ngày + Tiền mặt + Đã đếm luôn hiện"
      minimalLabel="Chỉ ngày + tiền mặt"
      defaultHidden={COLS.map((c) => c.n)}
    >
      {children}
    </ColumnToggle>
  );
}
