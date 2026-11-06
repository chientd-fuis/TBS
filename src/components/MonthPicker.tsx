import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { nextMonth, prevMonth, viMonth } from "@/lib/time";

export function MonthPicker({ month, base, params = {} }: { month: string; base: string; params?: Record<string, string | undefined> }) {
  const q = (m: string) => {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v && sp.set(k, v));
    sp.set("month", m);
    return `${base}?${sp.toString()}`;
  };
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-white p-1 ring-1 ring-[#f1e6c8]">
      <Link href={q(prevMonth(month))} className="rounded-lg p-1.5 hover:bg-primary-light" aria-label="Tháng trước"><ChevronLeft size={18} /></Link>
      <span className="min-w-20 text-center text-sm font-semibold">Tháng {viMonth(month)}</span>
      <Link href={q(nextMonth(month))} className="rounded-lg p-1.5 hover:bg-primary-light" aria-label="Tháng sau"><ChevronRight size={18} /></Link>
    </div>
  );
}
