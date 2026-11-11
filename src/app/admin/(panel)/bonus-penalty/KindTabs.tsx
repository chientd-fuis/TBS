"use client";
import { useState } from "react";
import { Gift, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/format";

/** Chọn loại Phạt (đỏ) / Thưởng (xanh) dạng tab – thay cho ô chọn. Mặc định Phạt. Gửi lên qua input ẩn name="kind". */
export default function KindTabs({ defaultValue = "PENALTY", size = "md" }: { defaultValue?: "BONUS" | "PENALTY"; size?: "md" | "sm" }) {
  const [kind, setKind] = useState<"BONUS" | "PENALTY">(defaultValue);
  const btn = size === "sm" ? "py-1.5 text-xs" : "py-2.5 text-sm";
  return (
    <div>
      <input type="hidden" name="kind" value={kind} />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist" aria-label="Loại">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "PENALTY"}
          onClick={() => setKind("PENALTY")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg font-bold transition",
            btn,
            kind === "PENALTY" ? "bg-danger text-white shadow" : "text-danger hover:bg-[#fde2e2]",
          )}
        >
          <TriangleAlert size={size === "sm" ? 14 : 16} /> Phạt
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "BONUS"}
          onClick={() => setKind("BONUS")}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-lg font-bold transition",
            btn,
            kind === "BONUS" ? "bg-bonus text-white shadow" : "text-bonus hover:bg-[#e3f3e7]",
          )}
        >
          <Gift size={size === "sm" ? 14 : 16} /> Thưởng
        </button>
      </div>
    </div>
  );
}
