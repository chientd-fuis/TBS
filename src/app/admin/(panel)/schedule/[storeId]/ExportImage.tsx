"use client";
import { useRef, useState } from "react";
import { Copy, ImageDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import type { Entry, TplInfo } from "@/lib/schedule";
import WeekSheet from "./WeekSheet";

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
  supportFrom,
}: {
  storeName: string;
  weekStart: string;
  days: string[];
  templates: TplInfo[];
  entries: Entry[];
  names: Record<string, string>;
  supportFrom?: Record<string, string>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [withPending, setWithPending] = useState(false);
  const [busy, setBusy] = useState<"" | "png" | "copy">("");
  const [note, setNote] = useState("");

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
        <WeekSheet ref={ref} storeName={storeName} days={days} templates={templates} entries={entries} names={names} withPending={withPending} supportFrom={supportFrom} />
      </div>
    </div>
  );
}
