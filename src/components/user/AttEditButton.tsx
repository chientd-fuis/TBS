"use client";
import type { ReactNode } from "react";
import { Pencil } from "lucide-react";

/** Sự kiện mở popup "Sửa giờ ca đã chấm" cho 1 lượt – RequestSheet (trang Lịch sử) lắng nghe */
export const ATT_EDIT_EVENT = "tbs:att-edit";

/** Bọc các nhãn cảnh báo (Quên check-out / Đi muộn / Về sớm) của 1 lượt → bấm mở popup sửa giờ đúng lượt đó */
export default function AttEditButton({ id, children }: { id: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(ATT_EDIT_EVENT, { detail: id }))}
      title="Gửi yêu cầu sửa giờ lượt này"
      className="inline-flex items-center gap-1 rounded-full p-0.5 pr-1.5 ring-1 ring-primary-dark/60 hover:bg-primary-light active:scale-95"
    >
      <span className="space-x-1">{children}</span>
      <Pencil size={12} className="shrink-0 text-accent" aria-hidden />
    </button>
  );
}
