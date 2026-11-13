"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";

/** Sự kiện mở khung "Sửa giờ ca đã chấm" cho 1 lượt – RequestSheet (trang Lịch sử) lắng nghe */
export const ATT_EDIT_EVENT = "tbs:att-edit";
/** RequestSheet báo lượt đang được sửa (id | null) → nhãn của lượt đó trong bảng hiện "Đang sửa ↓" */
export const ATT_EDITING_EVENT = "tbs:att-editing";

type W = Window & { __tbsEditing?: string | null };

/** Bọc các nhãn cảnh báo (Quên check-out / Đi muộn / Về sớm) của 1 lượt → bấm mở khung sửa giờ đúng lượt đó (dưới bảng) */
export default function AttEditButton({ id, children }: { id: string; children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const w = window as W;
    setEditing(w.__tbsEditing === id);
    const on = (e: Event) => {
      const cur = (e as CustomEvent<string | null>).detail;
      w.__tbsEditing = cur;
      setEditing(cur === id);
    };
    window.addEventListener(ATT_EDITING_EVENT, on);
    return () => window.removeEventListener(ATT_EDITING_EVENT, on);
  }, [id]);
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(ATT_EDIT_EVENT, { detail: id }))}
      title="Gửi yêu cầu sửa giờ lượt này"
      className={`inline-flex items-center gap-1 rounded-full p-0.5 pr-1.5 hover:bg-primary-light active:scale-95 ${editing ? "ring-2 ring-accent" : "ring-1 ring-primary-dark/60"}`}
    >
      <span className="space-x-1">{children}</span>
      {editing ? (
        <span className="text-[11px] font-bold text-accent">Đang sửa ↓</span>
      ) : (
        <Pencil size={12} className="shrink-0 text-accent" aria-hidden />
      )}
    </button>
  );
}
