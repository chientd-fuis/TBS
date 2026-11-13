"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import RulesView from "@/components/RulesView";
import type { FaqItem } from "@/lib/help";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Các tình huống hay gặp: ô tìm (không dấu cũng được) + danh sách câu hỏi bấm để mở câu trả lời. */
export default function FaqList({ items }: { items: FaqItem[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const shown = useMemo(() => {
    const k = norm(q.trim());
    return items.map((x, i) => ({ ...x, i })).filter((x) => !k || norm(`${x.q} ${x.a}`).includes(k));
  }, [items, q]);
  if (!items.length) return <p className="py-6 text-center text-sm text-ink/60">Chưa có tình huống nào – admin cập nhật ở Cài đặt → Help.</p>;
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-line focus-within:ring-2 focus-within:ring-primary">
        <Search size={16} className="shrink-0 text-ink/50" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tình huống… (VD: khách đổi món)" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </label>
      {!shown.length && <p className="py-4 text-center text-sm text-ink/60">Không thấy tình huống phù hợp – hỏi quản lý ca.</p>}
      <ul className="space-y-2">
        {shown.map((x) => {
          const on = open === x.i || (!!q.trim() && shown.length <= 3);
          return (
            <li key={x.i} className="overflow-hidden rounded-2xl bg-card ring-1 ring-line">
              <button
                type="button"
                onClick={() => setOpen(open === x.i ? null : x.i)}
                aria-expanded={on}
                className="flex w-full items-start gap-2 px-3 py-3 text-left text-[15px] font-semibold text-accent"
              >
                <span className="mt-0.5 shrink-0 rounded-full bg-primary px-1.5 text-xs font-bold text-on-primary">?</span>
                <span className="min-w-0 flex-1">{x.q}</span>
                <ChevronDown size={18} className={`mt-0.5 shrink-0 transition-transform ${on ? "rotate-180" : ""}`} />
              </button>
              {on && (
                <div className="border-t border-line bg-cream/60 px-3 py-3">
                  <RulesView text={x.a} empty="(chưa có câu trả lời)" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
