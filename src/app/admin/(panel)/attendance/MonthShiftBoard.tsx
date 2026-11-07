import Link from "next/link";
import { AlarmClock, CirclePlus, LogOut } from "lucide-react";
import { ROW_COLORS } from "@/components/WeekGrid";
import type { BoardChip, BoardTpl } from "@/lib/attendance-board";
import { weekdayVi } from "@/lib/time";
import ScrollToToday from "./ScrollToToday";

const WD_SHORT: Record<string, string> = { "Thứ 2": "T2", "Thứ 3": "T3", "Thứ 4": "T4", "Thứ 5": "T5", "Thứ 6": "T6", "Thứ 7": "T7", "Chủ Nhật": "CN" };

/** Bảng chấm công theo ca cả tháng (giống bảng xếp ca – chế độ xem), cuộn ngang. */
export default function MonthShiftBoard({
  month,
  days,
  today,
  templates,
  cells,
  rowsPerTpl,
  storeNames,
  hrefFor,
  compactLegend,
  linkable = true,
}: {
  month: string;
  days: string[];
  today: string;
  templates: BoardTpl[];
  cells: Record<string, BoardChip[]>;
  rowsPerTpl: Record<string, number>;
  storeNames: Record<string, string>;
  /** đường dẫn khi bấm tên (mặc định: bảng chấm công chi tiết của admin) */
  hrefFor?: (c: BoardChip) => string;
  /** chú thích ngắn (trang nhân viên) */
  compactLegend?: boolean;
  /** false = tên không bấm được (trang nhân viên) */
  linkable?: boolean;
}) {
  const border = "1px solid #9fb3cf";
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/70">
        <span className="inline-flex items-center gap-1"><AlarmClock size={13} className="text-warn" /> đi muộn / về sớm</span>
        <span className="inline-flex items-center gap-1"><CirclePlus size={13} className="text-secondary" /> làm thêm ca (không có lịch)</span>
        <span className="inline-flex items-center gap-1"><LogOut size={13} className="text-danger" /> quên check-out</span>
        <span className="inline-flex items-center gap-1"><b className="text-[10px] text-[#1d4ed8]">CS2</b> đi hỗ trợ / từ cơ sở khác sang</span>
        <span className="inline-flex items-center gap-1"><span className="rounded bg-gray-300 px-1 text-gray-600 line-through">Tên</span> {compactLegend ? "bỏ ca" : "bỏ ca (có lịch, không chấm công)"}</span>
        <span><b>Tên đậm</b> = ca sắp tới · <span className="text-ink/55">tên mờ</span> = ca đã qua</span>
        {compactLegend && <span className="rounded bg-[#ffd8b8] px-1 italic text-warn">chờ duyệt</span>}
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-[#c9d6e8]" data-month-board>
        <ScrollToToday />
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20" style={{ width: 92, minWidth: 92, background: "#a9c4ea", border, padding: "6px 4px" }}>Ca</th>
              {days.map((d) => (
                <th key={d} data-today={d === today ? "1" : undefined} style={{ width: 118, minWidth: 118, background: d === today ? "#fccc18" : "#a9c4ea", border, padding: "4px 2px" }}>
                  <div style={{ fontWeight: 700 }}>{WD_SHORT[weekdayVi(d)] ?? weekdayVi(d)}</div>
                  <div style={{ fontSize: 11, fontWeight: 400 }}>{d.slice(8)}/{d.slice(5, 7)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {templates.flatMap((t, ti) => {
              const bg = ROW_COLORS[ti % ROW_COLORS.length];
              const n = rowsPerTpl[t.id] ?? 2;
              return Array.from({ length: n }, (_, r) => (
                <tr key={`${t.id}-${r}`} style={{ background: bg }}>
                  {r === 0 && (
                    <th rowSpan={n} className="sticky left-0 z-10" style={{ background: bg, border, padding: 4, verticalAlign: "middle" }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{t.name}</div>
                      <div style={{ fontSize: 11, fontWeight: 400 }}>{t.startTime}–{t.endTime}</div>
                    </th>
                  )}
                  {days.map((d) => {
                    const c = cells[`${d}|${t.id}`]?.[r];
                    return (
                      <td key={d} style={{ border, padding: "2px 3px", height: 28, whiteSpace: "nowrap", overflow: "hidden" }}>
                        {c && <Chip c={c} month={month} storeNames={storeNames} href={hrefFor?.(c)} linkable={linkable} />}
                      </td>
                    );
                  })}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Chip({ c, month, storeNames, href, linkable }: { c: BoardChip; month: string; storeNames: Record<string, string>; href?: string; linkable: boolean }) {
  const title = [
    c.state === "missed" ? "Bỏ ca – có lịch nhưng không chấm công" : c.state === "upcoming" ? "Ca chưa tới" : c.state === "pending" ? "Đăng ký – chờ duyệt" : "",
    c.late ? `Đi muộn ${c.late} phút` : "",
    c.early ? `Về sớm ${c.early} phút` : "",
    c.extra ? "Làm thêm ca (không có lịch)" : "",
    c.missingOut ? "Quên check-out" : "",
    c.tag ? (c.tag.kind === "away" ? `Đi hỗ trợ ${storeNames[c.tag.storeId] ?? ""}` : `Từ ${storeNames[c.tag.storeId] ?? ""} sang hỗ trợ`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const content = (
    <>
      <span className="truncate">{c.name}</span>
      {(c.late || c.early) && <AlarmClock size={12} className="shrink-0 text-warn" />}
      {c.extra && <CirclePlus size={12} className="shrink-0 text-secondary" />}
      {c.missingOut && <LogOut size={12} className="shrink-0 text-danger" />}
      {c.tag && <b className="shrink-0 text-[9px] leading-none text-[#1d4ed8]">{c.tag.label}</b>}
    </>
  );
  const stateCls =
    c.state === "missed"
      ? "bg-gray-300 text-gray-600 line-through"
      : c.state === "upcoming"
        ? "bg-white/80 font-bold" // ca sắp tới: in đậm
        : c.state === "pending"
          ? "bg-[#ffd8b8] italic text-warn"
          : "bg-white/50 text-ink/55"; // ca đã qua (đã chấm công): mờ nhẹ
  const cls = `flex items-center gap-0.5 rounded px-1 leading-6 ${stateCls}`;
  return linkable ? (
    <Link
      href={href ?? `/admin/attendance?store=${c.linkStoreId}&user=${c.userId}&month=${month}`}
      title={title || "Xem bảng chấm công chi tiết"}
      className={`${cls} hover:underline`}
    >
      {content}
    </Link>
  ) : (
    <span title={title || undefined} className={cls}>
      {content}
    </span>
  );
}
