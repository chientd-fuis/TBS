import type { ReactNode } from "react";
import { cn } from "@/lib/format";
import { weekdayVi } from "@/lib/time";

/* Bảng lịch tuần theo mẫu: hàng = ca (S/C/T…), cột = Thứ 2 → Chủ Nhật. Dùng chung cho admin & nhân viên. */

export const ROW_COLORS = ["#d9e6f6", "#fdf0c4", "#f6dbe4", "#dff1e4", "#e9e1f6", "#fde3cf"];

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
    <div className="overflow-x-auto rounded-xl ring-1 ring-[#c9d6e8]">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-28 border border-[#c9d6e8] bg-[#a9c4ea] px-2 py-2 text-ink">Ca làm việc</th>
            {days.map((d) => (
              <th key={d} className={cn("border border-[#c9d6e8] bg-[#a9c4ea] px-2 py-1.5 text-ink", d === today && "bg-primary")}>
                <div className="font-bold">{weekdayVi(d)}</div>
                <div className="text-[11px] font-normal">{d.slice(8)}/{d.slice(5, 7)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.map((t, i) => (
            <tr key={t.id} style={{ background: ROW_COLORS[i % ROW_COLORS.length] }}>
              <th className="border border-[#c9d6e8] px-2 py-2 align-middle">
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
                <td key={d} className={cn("h-20 border border-[#c9d6e8] p-1 align-top", cellClass?.(t, d))}>
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
