import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MonthPicker } from "@/components/MonthPicker";
import { addDays, localDate, monthRange, nextMonth, prevMonth, viDate } from "@/lib/time";
import { cn } from "@/lib/format";

/** Số ngày từ a tới b (gồm 2 đầu). */
export const spanDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** Kỳ "giữa tháng": ngày `day` tháng này → ngày (day−1) tháng sau, chứa `today`. */
export function midMonthPeriod(today: string, day = 15) {
  const dd = String(day).padStart(2, "0");
  const m = Number(today.slice(8)) >= day ? today.slice(0, 7) : prevMonth(today.slice(0, 7));
  const from = `${m}-${dd}`;
  const nm = nextMonth(m);
  const to = day === 1 ? monthRange(m).last : addDays(`${nm}-${dd}`, -1);
  return { from, to };
}

/**
 * Chọn kỳ xem Lãi lỗ: theo tháng (mặc định) hoặc khoảng ngày tuỳ chọn (VD 15/11 → 14/12).
 * Khoảng tuỳ chọn có nút ‹ › lùi / tiến đúng bằng độ dài khoảng.
 */
export default function PeriodPicker({
  mode,
  month,
  from,
  to,
  alloc,
}: {
  mode: "month" | "range";
  month: string;
  from: string;
  to: string;
  alloc: boolean;
}) {
  const today = localDate(new Date());
  const q = (p: Record<string, string>) => `/admin/finance?${new URLSearchParams({ ...p, ...(alloc ? { alloc: "1" } : {}) }).toString()}`;
  const n = spanDays(from, to);
  const mid = midMonthPeriod(today);
  const prevMid = midMonthPeriod(addDays(mid.from, -1));
  const presets = [
    { label: `Kỳ giữa tháng ${viDate(mid.from).slice(0, 5)} – ${viDate(mid.to).slice(0, 5)}`, ...mid },
    { label: `Kỳ trước ${viDate(prevMid.from).slice(0, 5)} – ${viDate(prevMid.to).slice(0, 5)}`, ...prevMid },
    { label: "7 ngày qua", from: addDays(today, -6), to: today },
    { label: "30 ngày qua", from: addDays(today, -29), to: today },
  ];
  const tab = (on: boolean) => cn("rounded-md px-2.5 py-1", on && "bg-card font-bold shadow-sm");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-mute-bg p-0.5 text-xs">
          <Link href={q({ month })} className={tab(mode === "month")}>Theo tháng</Link>
          <Link href={q({ from: mid.from, to: mid.to })} className={tab(mode === "range")}>Khoảng ngày</Link>
        </div>
        {mode === "month" ? (
          <MonthPicker month={month} base="/admin/finance" params={{ alloc: alloc ? "1" : undefined }} />
        ) : (
          <div className="inline-flex items-center gap-1 rounded-xl bg-card p-1 ring-1 ring-line">
            <Link href={q({ from: addDays(from, -n), to: addDays(to, -n) })} className="rounded-lg p-1.5 hover:bg-primary-light" aria-label="Kỳ trước">
              <ChevronLeft size={18} />
            </Link>
            <span className="px-1 text-center text-sm font-semibold">
              {viDate(from)} – {viDate(to)} <span className="font-normal text-ink/50">({n} ngày)</span>
            </span>
            <Link href={q({ from: addDays(from, n), to: addDays(to, n) })} className="rounded-lg p-1.5 hover:bg-primary-light" aria-label="Kỳ sau">
              <ChevronRight size={18} />
            </Link>
          </div>
        )}
      </div>
      {mode === "range" && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl bg-card p-2 ring-1 ring-line">
          <form action="/admin/finance" className="flex flex-wrap items-end gap-2">
            {alloc && <input type="hidden" name="alloc" value="1" />}
            <label className="text-xs text-ink/60">
              Từ ngày
              <input type="date" name="from" defaultValue={from} required className="mt-0.5 block rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink" />
            </label>
            <label className="text-xs text-ink/60">
              Đến ngày
              <input type="date" name="to" defaultValue={to} required className="mt-0.5 block rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink" />
            </label>
            <button type="submit" className="rounded-lg bg-secondary px-3 py-1.5 text-sm font-bold text-white">Xem</button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <Link
                key={p.label}
                href={q({ from: p.from, to: p.to })}
                className={cn("rounded-full px-2.5 py-1 text-xs ring-1 ring-line", p.from === from && p.to === to ? "bg-secondary font-bold text-white" : "hover:bg-primary-light")}
              >
                {p.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
