"use client";
import { useRef, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * Form lọc tự áp dụng: đổi ô chọn là lọc ngay (không cần nút "Lọc").
 * - Ô chọn / ngày / tháng: lọc ngay khi đổi.
 * - Ô gõ chữ (tìm kiếm): lọc sau khi ngừng gõ ~0,4 giây, hoặc khi bấm Enter.
 * resetOnChange: khi ô X đổi thì xoá giá trị các ô phụ thuộc (VD đổi cơ sở → bỏ chọn nhân viên).
 */
export function AutoFilterForm({
  children,
  className,
  resetOnChange = {},
}: {
  children: ReactNode;
  className?: string;
  resetOnChange?: Record<string, string[]>;
}) {
  const router = useRouter();
  const path = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (form: HTMLFormElement, changed?: string) => {
    if (timer.current) clearTimeout(timer.current);
    const fd = new FormData(form);
    for (const dep of (changed && resetOnChange[changed]) || []) fd.delete(dep);
    const sp = new URLSearchParams();
    fd.forEach((v, k) => {
      if (typeof v === "string" && v.trim() !== "") sp.set(k, v.trim());
    });
    router.replace(`${path}?${sp.toString()}`, { scroll: false });
  };

  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        apply(e.currentTarget);
      }}
      onChange={(e) => {
        const form = e.currentTarget;
        const el = e.target as unknown as HTMLInputElement;
        if (el.tagName === "INPUT" && ["text", "search", "email", "tel"].includes(el.type)) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(form, el.name), 400);
        } else apply(form, el.name);
      }}
    >
      {children}
    </form>
  );
}
