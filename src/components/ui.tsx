import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "secondary" | "outline" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-primary text-ink hover:bg-primary-dark border border-primary-dark",
  secondary: "bg-secondary text-white hover:bg-secondary-dark",
  outline: "bg-white text-ink border border-[#e9d9a8] hover:bg-primary-light",
  danger: "bg-danger text-white hover:opacity-90",
  ghost: "text-accent hover:bg-primary-light",
};
const base =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition active:scale-[.97] disabled:active:scale-100 disabled:opacity-50 disabled:cursor-not-allowed";

/** Vòng xoay nhỏ dùng trong nút (kế thừa màu chữ của nút) */
export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-[2.5px] border-current border-r-transparent", className)} />;
}

/**
 * Nút dùng chung. loading = đang xử lý (phương án D): hiện vòng xoay + loadingText (mặc định giữ chữ cũ), khoá không bấm lại.
 * Khi chạm: nút lún nhẹ (active:scale).
 */
export function Button({
  variant = "primary",
  className,
  loading = false,
  loadingText,
  children,
  disabled,
  ...p
}: ComponentProps<"button"> & { variant?: Variant; loading?: boolean; loadingText?: ReactNode }) {
  return (
    <button className={cn(base, variants[variant], loading && "disabled:opacity-80 disabled:cursor-wait", className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {loading && <Spinner />}
      {loading && loadingText !== undefined ? loadingText : children}
    </button>
  );
}
export function LinkButton({
  variant = "primary",
  className,
  ...p
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cn(base, variants[variant], className)} {...p} />;
}

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#f1e6c8]", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-bold text-accent">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const inputCls =
  "block w-full min-w-0 max-w-full rounded-xl border border-[#e9d9a8] bg-white px-3 py-2 text-sm outline-none focus:border-primary-dark focus:ring-2 focus:ring-primary/40";
export function Input(p: ComponentProps<"input">) {
  return <input {...p} className={cn(inputCls, p.className)} />;
}
export function Select(p: ComponentProps<"select">) {
  return <select {...p} className={cn(inputCls, p.className)} />;
}
export function Textarea(p: ComponentProps<"textarea">) {
  return <textarea {...p} className={cn(inputCls, p.className)} />;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-xs font-semibold text-accent">{label}</span>
      {children}
      {hint && <span className="block text-xs text-ink/60">{hint}</span>}
    </label>
  );
}

type Tone = "yellow" | "green" | "orange" | "red" | "gray" | "pink" | "blue";
const tones: Record<Tone, string> = {
  yellow: "bg-primary-light text-ink",
  green: "bg-[#e3f3e7] text-secondary-dark",
  orange: "bg-[#ffe8d9] text-warn",
  red: "bg-[#fde2e2] text-danger",
  gray: "bg-gray-100 text-gray-600",
  pink: "bg-[#fbe4df] text-accent",
  blue: "bg-[#dbeafe] text-[#1e40af]",
};
export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone])}>{children}</span>;
}

export function Alert({ tone = "yellow", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={cn("rounded-xl px-4 py-3 text-sm", tones[tone])}>{children}</div>;
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-xl font-bold text-accent">{children}</h1>
      {sub && <p className="text-sm text-ink/70">{sub}</p>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink/50">{children}</p>;
}
