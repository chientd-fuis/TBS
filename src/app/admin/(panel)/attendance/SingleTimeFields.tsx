"use client";
import { useState } from "react";
import { Field } from "@/components/ui";
import TimeInput from "@/components/TimeInput";

type Tpl = { id: string; name: string; startTime: string; endTime: string };

/** Chấm hộ 1 lượt: chọn theo ca (lấy giờ của ca) hoặc tự nhập giờ vào / ra. */
export default function SingleTimeFields({ templates }: { templates: Tpl[] }) {
  const [mode, setMode] = useState<"time" | "shift">(templates.length ? "shift" : "time");
  const [tplId, setTplId] = useState(templates[0]?.id ?? "");
  const [onlyIn, setOnlyIn] = useState(false);
  const tpl = templates.find((t) => t.id === tplId);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" className="accent-[#3c9c54]" checked={mode === "shift"} disabled={!templates.length} onChange={() => setMode("shift")} />
          Theo ca (lấy giờ của ca)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" className="accent-[#3c9c54]" checked={mode === "time"} onChange={() => setMode("time")} />
          Tự nhập giờ vào / ra
        </label>
        {!templates.length && <span className="text-xs text-warn">Cơ sở chưa có ca mẫu</span>}
      </div>
      {mode === "shift" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTplId(t.id)}
                className={`rounded-full border px-3 py-1 text-sm ${tplId === t.id ? "border-secondary bg-secondary text-white" : "border-ink/15 bg-white text-ink/80"}`}
              >
                {t.name} {t.startTime}–{t.endTime}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" className="accent-[#3c9c54]" checked={onlyIn} onChange={(e) => setOnlyIn(e.target.checked)} />
            Chỉ check-in (nhân viên vẫn đang làm, chưa ra ca)
          </label>
          {tpl && (
            <p className="text-xs text-ink/70">
              Ghi nhận: vào <b>{tpl.startTime}</b>
              {onlyIn ? " · chưa check-out" : <> · ra <b>{tpl.endTime}</b></>}
            </p>
          )}
          <input type="hidden" name="inTime" value={tpl?.startTime ?? ""} />
          <input type="hidden" name="outTime" value={onlyIn ? "" : (tpl?.endTime ?? "")} />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Giờ vào"><TimeInput seconds name="inTime" required /></Field>
          <Field label="Giờ ra" hint="Bỏ trống nếu chỉ check-in"><TimeInput seconds name="outTime" /></Field>
        </div>
      )}
    </div>
  );
}
