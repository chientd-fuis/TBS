import { forwardRef } from "react";
import { ROW_COLORS } from "@/components/WeekGrid";
import type { Entry, TplInfo } from "@/lib/schedule";
import { viDate, weekdayVi } from "@/lib/time";

/**
 * Bảng lịch tuần "sạch" theo mẫu (ca × Thứ 2…CN, mỗi người 1 dòng) – dùng cho chế độ XEM và để xuất ảnh.
 * Viết bằng style inline để html-to-image chụp đúng.
 */
const WeekSheet = forwardRef<
  HTMLDivElement,
  {
    storeName: string;
    days: string[];
    templates: TplInfo[];
    entries: Entry[];
    names: Record<string, string>;
    withPending: boolean;
    supportFrom?: Record<string, string>;
    width?: number | string;
  }
>(function WeekSheet({ storeName, days, templates, entries, names, withPending, supportFrom = {}, width = 1100 }, ref) {
  const list = (tplId: string, date: string) =>
    entries
      .filter((e) => e.tplId === tplId && e.date === date && (e.status === "APPROVED" || (withPending && e.status === "PENDING")))
      .map((e) => ({ name: names[e.userId] ?? "?", pending: e.status === "PENDING", support: !!supportFrom[e.userId] }))
      .sort((a, b) => Number(a.pending) - Number(b.pending) || a.name.localeCompare(b.name));
  const rowsPerTpl = Math.max(3, ...templates.flatMap((t) => days.map((d) => list(t.id, d).length)));
  const cellBorder = "1px solid #9fb3cf";
  return (
    <div ref={ref} style={{ width, minWidth: typeof width === "string" ? 900 : undefined, padding: 24, background: "#fff", fontFamily: "Arial, 'Segoe UI', Roboto, sans-serif", color: "#2b1b1b" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={64} height={64} style={{ borderRadius: 999 }} />
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: "#783C3C" }}>Lịch làm việc – {storeName}</div>
          <div style={{ fontSize: 16 }}>
            Tuần {viDate(days[0])} – {viDate(days[6])}
          </div>
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: 110, background: "#a9c4ea", border: cellBorder, padding: "8px 4px" }}>Ca làm việc</th>
            {days.map((d) => (
              <th key={d} style={{ background: "#a9c4ea", border: cellBorder, padding: "6px 4px" }}>
                <div style={{ fontWeight: 700 }}>{weekdayVi(d)}</div>
                <div style={{ fontSize: 12, fontWeight: 400 }}>{d.slice(8)}/{d.slice(5, 7)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {templates.flatMap((t, ti) => {
            const bg = ROW_COLORS[ti % ROW_COLORS.length];
            return Array.from({ length: rowsPerTpl }, (_, r) => (
              <tr key={`${t.id}-${r}`} style={{ background: bg }}>
                {r === 0 && (
                  <th rowSpan={rowsPerTpl} style={{ border: cellBorder, padding: 6, verticalAlign: "middle" }}>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{t.name}</div>
                    <div style={{ fontSize: 12, fontWeight: 400 }}>{t.startTime}–{t.endTime}</div>
                  </th>
                )}
                {days.map((d) => {
                  const p = list(t.id, d)[r];
                  return (
                    <td
                      key={d}
                      style={{
                        border: cellBorder,
                        padding: "5px 4px",
                        textAlign: "center",
                        height: 30,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        color: p?.pending ? "#E8590C" : p?.support ? "#1e40af" : undefined,
                        fontStyle: p?.pending ? "italic" : undefined,
                      }}
                    >
                      {p ? `${p.support ? "⇄ " : ""}${p.name}${p.pending ? " (chờ)" : ""}` : ""}
                    </td>
                  );
                })}
              </tr>
            ));
          })}
        </tbody>
      </table>
      <div style={{ marginTop: 10, fontSize: 12, color: "#7a6a5a", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span>
          {templates.map((t) => `${t.name}: ${t.startTime}–${t.endTime}`).join("  ·  ")}
          {withPending ? "  ·  (chờ) = chưa duyệt" : ""}
          {Object.keys(supportFrom).length ? "  ·  ⇄ = hỗ trợ từ cơ sở khác" : ""}
        </span>
        <span>Tiệm Bơ Sầu</span>
      </div>
    </div>
  );
});

export default WeekSheet;
