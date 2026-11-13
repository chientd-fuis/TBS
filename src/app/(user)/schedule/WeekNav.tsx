import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, viDate } from "@/lib/time";
import { WeekBadge } from "@/components/WeekBadge";

export function WeekNav({ ws, href, min, label }: { ws: string; href: (w: string) => string; min?: string; label?: string }) {
  const prev = addDays(ws, -7);
  const canPrev = !min || prev >= min;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-card p-1 ring-1 ring-line">
      {canPrev ? (
        <Link href={href(prev)} className="rounded-lg p-2 hover:bg-primary-light" aria-label="Tuần trước"><ChevronLeft size={18} /></Link>
      ) : (
        <span className="p-2 text-ink/20"><ChevronLeft size={18} /></span>
      )}
      <span className="text-center text-sm font-bold">
        {viDate(ws).slice(0, 5)} – {viDate(addDays(ws, 6))}
        {label && (
          <span className="block">
            <WeekBadge label={label} />
          </span>
        )}
      </span>
      <Link href={href(addDays(ws, 7))} className="rounded-lg p-2 hover:bg-primary-light" aria-label="Tuần sau"><ChevronRight size={18} /></Link>
    </div>
  );
}
