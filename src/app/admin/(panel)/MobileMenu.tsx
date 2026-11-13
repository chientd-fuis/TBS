"use client";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import AdminNav from "./AdminNav";
import { canSee, NAV } from "./nav-items";

type NavProps = { counts: Record<string, number>; owner?: boolean; perms?: string[]; hide?: string[] };

/**
 * Điện thoại: nút ☰ (kèm tổng số việc chờ) + logo "Tiệm Bơ Sầu / Quản lý cửa hàng"; bấm ☰ → menu trượt từ trái (đủ mục, tài khoản, đăng xuất).
 * Máy tính (lg) không dùng – vẫn là menu dọc bên trái.
 */
export default function MobileMenu({ nav, account }: { nav: NavProps; account: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const access = { owner: !!nav.owner, perms: nav.perms ?? [], hide: nav.hide ?? [] };

  // tổng số chờ xử lý (chỉ các mục được thấy)
  let pending = 0;
  for (const g of NAV) {
    const links = g.links.filter((l) => canSee(l, access));
    pending += links.reduce((s, l) => s + (l.badge ? nav.counts[l.badge] ?? 0 : 0), 0);
  }

  // đổi trang → đóng menu
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Mở menu"
        aria-expanded={open}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white hover:bg-white/10 lg:hidden"
      >
        <Menu size={24} />
        {pending > 0 && (
          <span className="absolute top-1.5 right-1 min-w-4 rounded-full bg-danger px-1 text-[10px] leading-4 font-bold text-white">{pending}</span>
        )}
      </button>
      <Link href="/admin" className="flex min-w-0 flex-1 items-center gap-2 lg:hidden" title="Về Tổng quan">
        <Logo size={30} />
        {/* tên chức năng đã có ở tiêu đề trang → header chỉ giữ thương hiệu */}
        <span className="min-w-0 text-white">
          <span className="block truncate text-[15px] leading-tight font-bold">Tiệm Bơ Sầu</span>
          <span className="block truncate text-[11px] leading-tight opacity-80">Quản lý cửa hàng</span>
        </span>
      </Link>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-black/45 lg:hidden" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Menu">
            <aside
              className="flex h-full w-[300px] max-w-[85vw] flex-col bg-nav shadow-2xl"
              style={{ animation: "tbs-drawer-in .18s ease-out" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2 py-2.5 pr-2 pl-3.5">
                <Link href="/admin" className="flex min-w-0 flex-1 items-center gap-2.5" title="Về Tổng quan">
                  <Logo size={38} />
                  <span className="text-white">
                    <span className="block text-sm leading-tight font-bold">Tiệm Bơ Sầu</span>
                    <span className="block text-xs opacity-80">Quản lý cửa hàng</span>
                  </span>
                </Link>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng menu" className="flex h-11 w-11 items-center justify-center rounded-xl text-white hover:bg-white/10">
                  <X size={22} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AdminNav {...nav} vertical />
              </div>
              <div className="border-t border-white/20 px-3.5 pt-2.5 pb-4 text-white">{account}</div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}
