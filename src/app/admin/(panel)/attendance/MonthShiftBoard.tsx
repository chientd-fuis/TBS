import Link from "next/link";
import { AlarmClock, CirclePlus, LogOut } from "lucide-react";
import { ROW_COLORS } from "@/components/WeekGrid";
import type { BoardChip, BoardTpl } from "@/lib/attendance-board";
import { weekdayVi } from "@/lib/time";
import { minutesVi } from "@/lib/format";
import ScrollToToday from "./ScrollToToday";
import type { WeatherBadge } from "@/lib/weather";

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
  holidays = {},
  meId,
  weather,
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
  /** ngày lễ: ngày → tên + hệ số lương */
  holidays?: Record<string, { name: string; multiplier: number }>;
  /** xem lịch cả cửa hàng: tô nổi tên của người đang xem */
  meId?: string;
  /** dự báo thời tiết từng ngày (Cài đặt → AI → thời tiết → Lịch làm việc); warn = nên giảm ca */
  weather?: Record<string, WeatherBadge>;
}) {
  const border = "1px solid var(--color-grid-border)";
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink/70">
        <span className="inline-flex items-center gap-1"><AlarmClock size={13} className="text-warn" /> đi muộn / về sớm</span>
        <span className="inline-flex items-center gap-1"><CirclePlus size={13} className="text-secondary" /> làm thêm ca (không có lịch)</span>
        <span className="inline-flex items-center gap-1"><LogOut size={13} className="text-danger" /> quên check-out</span>
        <span className="inline-flex items-center gap-1"><b className="text-[10px] text-tag">CS2</b> đi hỗ trợ / từ cơ sở khác sang</span>
        <span className="inline-flex items-center gap-1"><span className="text-danger line-through">Tên</span> {compactLegend ? "bỏ ca" : "bỏ ca (có lịch, không chấm công)"}</span>
        <span className="inline-flex items-center gap-1"><span className="tbs-live">Tên</span> đang trong ca (nhấp nháy ở mọi ca nếu làm xuyên ca)</span>
        <span><b>Tên đậm</b> = ca sắp tới · <span className="text-ink/55">tên mờ</span> = ca đã qua</span>
        {compactLegend && <span>Tên <i className="text-warn">(Chờ duyệt)</i></span>}
        <span className="inline-flex items-center gap-1"><span className="rounded bg-holiday px-1 text-[10px] font-bold text-danger">🎉 Lễ ×2</span> ngày lễ – đi làm được nhân lương</span>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-grid-line" data-month-board>
        <ScrollToToday />
        <table style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 13, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20" style={{ width: 92, minWidth: 92, background: "var(--color-grid-head)", border, padding: "6px 4px" }}>Ca</th>
              {days.map((d) => {
                const h = holidays[d];
                const w = weather?.[d];
                return (
                  <th
                    key={d}
                    data-today={d === today ? "1" : undefined}
                    title={[h ? `Ngày lễ: ${h.name} – đi làm được ×${h.multiplier} lương` : "", w?.warn ? `⚠ ${w.warn}` : ""].filter(Boolean).join(" · ") || undefined}
                    style={{ width: 118, minWidth: 118, background: d === today ? "var(--color-primary)" : h ? "var(--color-holiday)" : w?.warn ? "var(--color-weather-warn)" : "var(--color-grid-head)", color: d === today ? "var(--color-on-primary)" : undefined, border, padding: "4px 2px" }}
                  >
                    <div style={{ fontWeight: 700 }}>{WD_SHORT[weekdayVi(d)] ?? weekdayVi(d)}</div>
                    <div style={{ fontSize: 11, fontWeight: 400 }}>{d.slice(8)}/{d.slice(5, 7)}</div>
                    {h && (
                      <div className="truncate text-danger" style={{ fontSize: 10, fontWeight: 700 }}>
                        🎉 {h.name} ×{h.multiplier}
                      </div>
                    )}
                    {w && (
                      <div style={{ fontSize: 10, fontWeight: w.warn ? 700 : 400, color: w.warn ? "var(--color-weather-fg)" : undefined }}>
                        {w.icon} {w.tMin}–{w.tMax}° ☔{w.rainPct}%{w.warn ? " ⚠" : ""}
                      </div>
                    )}
                  </th>
                );
              })}
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
                        {c && <Chip c={c} month={month} storeNames={storeNames} href={hrefFor?.(c)} linkable={linkable} me={!!meId && c.userId === meId} />}
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

function Chip({ c, month, storeNames, href, linkable, me = false }: { c: BoardChip; month: string; storeNames: Record<string, string>; href?: string; linkable: boolean; me?: boolean }) {
  const title = [
    c.state === "missed" ? "Bỏ ca – có lịch nhưng không chấm công" : c.state === "upcoming" ? "Ca chưa tới" : c.state === "pending" ? "Đăng ký – chờ duyệt" : "",
    c.late ? `Đi muộn ${minutesVi(c.late)}` : "",
    c.early ? `Về sớm ${minutesVi(c.early)}` : "",
    c.extra ? "Làm thêm ca (không có lịch)" : "",
    c.missingOut ? "Quên check-out" : "",
    c.live ? "Đang trong ca (chưa check-out)" : "",
    c.tag ? (c.tag.kind === "away" ? `Đi hỗ trợ ${storeNames[c.tag.storeId] ?? ""}` : `Từ ${storeNames[c.tag.storeId] ?? ""} sang hỗ trợ`) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const content = (
    <>
      <span className="truncate">{c.name}</span>
      {c.state === "pending" && <i className="shrink-0 text-[10px] text-warn">(Chờ duyệt)</i>}
      {(c.late || c.early) && <AlarmClock size={12} className="shrink-0 text-warn" />}
      {c.extra && <CirclePlus size={12} className="shrink-0 text-secondary" />}
      {c.missingOut && <LogOut size={12} className="shrink-0 text-danger" />}
      {c.tag && <b className="shrink-0 text-[9px] leading-none text-tag">{c.tag.label}</b>}
    </>
  );
  // không nền: đang trong ca = xanh lá đậm nhấp nháy · bỏ ca = chữ đỏ gạch ngang · sắp tới = đậm · đã qua = mờ nhẹ · chờ duyệt = bình thường + "(Chờ duyệt)"
  const stateCls = c.live
    ? "tbs-live"
    : c.state === "missed"
      ? "text-danger line-through"
      : c.state === "upcoming"
        ? "font-bold"
        : c.state === "pending"
          ? ""
          : "text-ink/55";
  const cls = `flex items-center gap-0.5 rounded px-1 leading-6 ${stateCls}${me ? " bg-primary font-bold text-on-primary ring-1 ring-accent/40" : ""}`;
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
