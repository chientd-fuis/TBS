"use client";
import { useEffect, useState } from "react";
import RulesView from "@/components/RulesView";
import { cn } from "@/lib/format";
import { isPosition, POSITIONS, type PositionKey } from "@/lib/help";

const KEY = "tbs_help_position";

/**
 * Quy trình làm việc: hỏi "Bạn làm ở vị trí nào?" (Bếp / Thu ngân / Ship / Đa năng) → hiện quy trình vị trí đó.
 * Nhớ lựa chọn trên máy (lần sau mở thẳng), bấm "Đổi vị trí" để chọn lại. fixed: admin xem trước 1 vị trí.
 */
export default function WorkflowView({ content, fixed }: { content: Record<PositionKey, string>; fixed?: PositionKey }) {
  const [pos, setPos] = useState<PositionKey | null>(fixed ?? null);
  useEffect(() => {
    if (fixed) return setPos(fixed);
    try {
      const v = localStorage.getItem(KEY);
      if (isPosition(v)) setPos(v);
    } catch {}
  }, [fixed]);
  const pick = (k: PositionKey) => {
    setPos(k);
    try {
      localStorage.setItem(KEY, k);
    } catch {}
  };

  if (!pos)
    return (
      <div className="space-y-3">
        <p className="text-center text-base font-bold text-accent">Bạn làm ở vị trí nào?</p>
        <div className="grid grid-cols-2 gap-3">
          {POSITIONS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => pick(p.key)}
              className="flex flex-col items-center gap-1 rounded-2xl bg-card px-3 py-5 text-[15px] font-bold text-accent ring-1 ring-line hover:bg-primary-light active:scale-[.98]"
            >
              <span className="text-3xl" aria-hidden>{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    );

  const cur = POSITIONS.find((p) => p.key === pos)!;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {POSITIONS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => (fixed ? undefined : pick(p.key))}
            disabled={!!fixed && p.key !== pos}
            className={cn(
              "rounded-full px-3 py-1.5 text-sm",
              p.key === pos ? "bg-secondary font-bold text-white" : "bg-card text-ink/70 ring-1 ring-line",
              fixed && p.key !== pos && "opacity-40",
            )}
          >
            {p.icon} {p.label}
          </button>
        ))}
      </div>
      <h3 className="text-lg font-bold text-accent">
        {cur.icon} Quy trình – {cur.label}
      </h3>
      <RulesView text={content[pos]} empty={`Chưa có quy trình cho vị trí ${cur.label} – admin cập nhật ở Cài đặt → Help.`} />
    </div>
  );
}
