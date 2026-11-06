"use client";
import { useRef, useState } from "react";
import { Copy, ImageDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { ROW_COLORS } from "@/components/WeekGrid";
import type { Entry, TplInfo } from "@/lib/schedule";
import { viDate, weekdayVi } from "@/lib/time";

/**
 * Xuất ẢNH (PNG) lịch làm việc của tuần đang xếp – đúng mẫu bảng S/C/T × Thứ 2…CN,
 * để gửi nhóm Zalo / in dán ở quán. Ảnh được vẽ từ một bảng "sạch" (không nút bấm) dựng riêng.
 */
export default function ExportImage({
  storeName,
  weekStart,
  days,
  templates,
  entries,
  names,
}: {
  storeName: string;
  weekStart: string;
  days: string[];
  templates: TplInfo[];
  entries: Entry[];
  names: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [withPending, setWithPending] = useState(false);
  const [busy, setBusy] = useState<"" | "png" | "copy">("");
  const [note, setNote] = useState("");

  const list = (tplId: string, date: string) =>
    entries
      .filter((e) => e.tplId === tplId && e.date === date && (e.status === "APPROVED" || (withPending && e.status === "PENDING")))
      .map((e) => ({ name: names[e.userId] ?? "?", pending: e.status === "PENDING" }))
      .sort((a, b) => Number(a.pending) - Number(b.pending) || a.name.localeCompare(b.name));
  const rowsPerTpl = Math.max(3, ...templates.flatMap((t) => days.map((d) => list(t.id, d).length)));
  const fileName = `TBS_LichLamViec_${storeName.replace(/^TBS\s*/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/\s+/g, "")}_${weekStart}.png`;

  const render = async () => {
    const { toBlob } = await import("html-to-image");
    if (!ref.current) throw new Error("Không dựng được bảng");
    // skipFonts: không nhúng Google Fonts (tránh lỗi CORS) – bảng ảnh dùng font hệ thống có dấu tiếng Việt
    const blob = await toBlob(ref.current, { pixelRatio: 2, backgroundColor: "#ffffff", skipFonts: true, cacheBust: true });
    if (!blob) throw new Error("Không tạo được ảnh");
    return blob;
  };

  const download = async () => {
    setBusy("png");
    setNote("");
    try {
      const blob = await render();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      setNote("Lỗi xuất ảnh: " + (e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const copy = async () => {
    setBusy("copy");
    setNote("");
    try {
      const blob = await render();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("Đã sao chép ảnh – dán (Ctrl+V) vào Zalo / Messenger.");
    } catch {
      setNote("Trình duyệt không cho sao chép ảnh – hãy dùng nút Tải ảnh.");
    } finally {
      setBusy("");
    }
  };

  const cellBorder = "1px solid #9fb3cf";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={download} disabled={!!busy}>
        {busy === "png" ? <Loader2 size={16} className="animate-spin" /> : <ImageDown size={16} />} Xuất ảnh lịch tuần
      </Button>
      <Button variant="ghost" onClick={copy} disabled={!!busy} title="Sao chép ảnh để dán vào Zalo">
        {busy === "copy" ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />} Sao chép ảnh
      </Button>
      <label className="flex items-center gap-1 text-xs">
        <input type="checkbox" className="accent-[#3c9c54]" checked={withPending} onChange={(e) => setWithPending(e.target.checked)} />
        Kèm ca chờ duyệt
      </label>
      {note && <span className="text-xs text-accent">{note}</span>}

      {/* Bảng dùng để chụp – đặt ngoài màn hình */}
      <div style={{ position: "fixed", left: -10000, top: 0, pointerEvents: "none" }} aria-hidden>
        <div ref={ref} style={{ width: 1100, padding: 24, background: "#fff", fontFamily: "Arial, 'Segoe UI', Roboto, sans-serif", color: "#2b1b1b" }}>
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
                        <td key={d} style={{ border: cellBorder, padding: "5px 4px", textAlign: "center", height: 30, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: p?.pending ? "#E8590C" : undefined, fontStyle: p?.pending ? "italic" : undefined }}>
                          {p ? p.name + (p.pending ? " (chờ)" : "") : ""}
                        </td>
                      );
                    })}
                  </tr>
                ));
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 12, color: "#7a6a5a", display: "flex", justifyContent: "space-between" }}>
            <span>{templates.map((t) => `${t.name}: ${t.startTime}–${t.endTime}`).join("  ·  ")}{withPending ? "  ·  (chờ) = chưa duyệt" : ""}</span>
            <span>Tiệm Bơ Sầu · xuất lúc {new Date().toLocaleString("vi-VN")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
