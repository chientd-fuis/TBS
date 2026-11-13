import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { weekdayVi } from "@/lib/time";

/* Bảng lịch tuần theo mẫu: hàng = ca (S/C/T…), cột = Thứ 2 → Chủ Nhật. Dùng chung cho admin & nhân viên. */

/** màu nền từng hàng ca – biến CSS (globals.css --color-grid-1..6) để theme Tối đổi sang bản tối */
export const ROW_COLORS = [1, 2, 3, 4, 5, 6].map((i) => `var(--color-grid-${i})`);

export type GridTpl = { id: string; name: string; startTime: string; endTime: string; minStaff?: number; targetStaff?: number };

export function WeekGrid({
  templates,
  days,
  today,
  renderCell,
  cellClass,
  renderRowHead,
}: {
  templates: GridTpl[];
  days: string[];
  today?: string;
  renderCell: (tpl: GridTpl, date: string) => ReactNode;
  cellClass?: (tpl: GridTpl, date: string) => string | undefined;
  renderRowHead?: (tpl: GridTpl) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-grid-line">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-28 border border-grid-line bg-grid-head px-2 py-2 text-ink">Ca làm việc</th>
            {days.map((d) => (
              <th key={d} className={cn("border border-grid-line px-2 py-1.5", d === today ? "bg-primary text-on-primary" : "bg-grid-head text-ink")}>
                <div className="font-bold">{weekdayVi(d)}</div>
                <div className="text-[11px] font-normal">{d.slice(8)}/{d.slice(5, 7)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t, i) => (
            <tr key={t.id} style={{ background: ROW_COLORS[i % ROW_COLORS.length] }}>
              <th className="border border-grid-line px-2 py-2 align-middle">
                {renderRowHead ? (
                  renderRowHead(t)
                ) : (
                  <>
                    <div className="text-base font-bold">{t.name}</div>
                    <div className="text-[11px] font-normal">{t.startTime}–{t.endTime}</div>
                  </>
                )}
              </th>
              {days.map((d) => (
                <td key={d} className={cn("h-20 border border-grid-line p-1 align-top", cellClass?.(t, d))}>
                  {renderCell(t, d)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
