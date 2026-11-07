"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Loader2, TriangleAlert, X } from "lucide-react";
import PhotoCamera from "@/components/user/PhotoCamera";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";
import { CLOSING_SHIFTS, evalMoneyExpr, REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type ClosingShiftKey, type Revenue, type RevenueKey } from "@/lib/revenue";
import { viDate } from "@/lib/time";

type Raw = Record<RevenueKey, string>;
const EMPTY: Raw = { dt: "", tm: "", tk: "", cp: "", grab: "", shopee: "" };
const HINT: Partial<Record<RevenueKey, string>> = { cp: "VD: 30k sữa chua + 20k ship" };

export default function ClosingForm({
  scheduledShift,
  defaultShift,
  dates,
  checkIn,
  employee,
  storeName,
  dayBefore,
}: {
  scheduledShift: string | null; // ca được xếp lịch (để tham khảo)
  defaultShift: ClosingShiftKey;
  dates: Record<ClosingShiftKey, string>; // ngày doanh thu theo từng ca chốt
  checkIn?: string | null;
  employee?: string;
  storeName?: string;
  /** các ca đã chốt trước trong ngày (để ca cuối thấy tổng ngày) */
  dayBefore: { label: string; dt: number; diff: number }[];
}) {
  const router = useRouter();
  const device = useDevice();
  const [note, setNote] = useState("");
  const [raw, setRaw] = useState<Raw>(EMPTY);
  const [shiftKey, setShiftKey] = useState<ClosingShiftKey>(defaultShift);
  const isDayEnd = shiftKey === "T";
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false); // đang mở camera chụp ảnh chốt ca
  const [result, setResult] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);

  const evals = Object.fromEntries(REVENUE_KEYS.map((k) => [k, evalMoneyExpr(raw[k])])) as Record<RevenueKey, ReturnType<typeof evalMoneyExpr>>;
  const revenue = Object.fromEntries(REVENUE_KEYS.map((k) => [k, evals[k].value])) as Revenue;
  const diff = revenueDiff(revenue);
  const hasDt = !!raw.dt.trim();
  const REQUIRED: RevenueKey[] = ["dt", "tm", "tk"];
  const missing = REQUIRED.filter((k) => !raw[k].trim());
  const invalid = REVENUE_KEYS.some((k) => raw[k].trim() && !evals[k].ok);
  const ready = !missing.length && !invalid;
  const dayTotal = dayBefore.reduce((s, x) => s + x.dt, 0) + revenue.dt;

  // chụp xong 1 ảnh → gửi luôn (ảnh chỉ gửi vào nhóm Telegram, không lưu)
  const submit = async (photo?: string) => {
    setShooting(false);
    setBusy(true);
    setResult(null);
    let pos: GeolocationPosition | null = null;
    try {
      pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
    } catch {}
    const r = await fetch("/api/closing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos: photo ? [photo] : [], closingShift: shiftKey, note, revenue, revenueInput: raw, lat: pos?.coords.latitude, lng: pos?.coords.longitude }),
    });
    const j = await r.json().catch(() => ({ error: "Lỗi mạng" }));
    setBusy(false);
    if (!r.ok) return setResult({ tone: "red", text: j.error || "Chốt ca thất bại" });
    setResult({ tone: j.telegram === "SENT" && j.sheet !== "FAILED" ? "green" : "orange", text: [j.message, j.sheetMessage].filter(Boolean).join(" ") });
    setNote("");
    setRaw(EMPTY);
    setShiftKey(defaultShift);
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <DeviceNotice info={device} />
      {result && (
        <Alert tone={result.tone}>
          {result.tone === "green" ? <CheckCircle2 size={16} className="mr-1 inline" /> : <TriangleAlert size={16} className="mr-1 inline" />}
          {result.text}
        </Alert>
      )}
      <Card>
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-ink/60">Cơ sở</dt><dd className="font-semibold">{storeName}</dd>
          <dt className="text-ink/60">Người chốt</dt><dd className="font-semibold">{employee}</dd>
          <dt className="text-ink/60">Vào ca</dt><dd>{checkIn || "Chưa check-in"}{scheduledShift ? ` · lịch: ${scheduledShift}` : ""}</dd>
          <dt className="text-ink/60">Ngày</dt><dd className="font-semibold">{dates[shiftKey] ? viDate(dates[shiftKey]) : "—"}</dd>
        </dl>
        <p className="mt-2 mb-1 text-xs font-semibold text-accent">Ca chốt</p>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ca chốt">
          {CLOSING_SHIFTS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={shiftKey === c.key}
              onClick={() => setShiftKey(c.key)}
              className={`rounded-xl px-2 py-2.5 text-center text-sm ring-1 transition ${
                shiftKey === c.key ? "bg-secondary font-bold text-white ring-secondary-dark" : "bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200"
              }`}
            >
              Ca {c.name}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Số liệu ca">
        <p className="mb-3 text-xs text-ink/70">Gõ được phép cộng, VD <b>10000 + 20000 + 20k</b>. Rời ô sẽ tự hiện tổng. Ô có * bắt buộc (không có thì nhập 0), ô khác bỏ trống = 0.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {REVENUE_KEYS.map((k) => (
            <div key={k} className={k === "dt" || k === "cp" ? "col-span-2" : ""}>
              <Field label={`${REVENUE_LABEL[k]}${REQUIRED.includes(k) ? " *" : ""}`}>
                <ExprMoneyInput value={raw[k]} onChange={(v) => setRaw((o) => ({ ...o, [k]: v }))} placeholder={HINT[k]} aria-label={REVENUE_LABEL[k]} />
              </Field>
            </div>
          ))}
        </div>

        <div className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 ${!hasDt ? "bg-cream" : diff === 0 ? "bg-[#e3f3e7]" : "bg-[#fde2e2]"}`}>
          <span className="text-sm font-semibold">Âm / Dương</span>
          <span className={`text-lg font-bold tabular-nums ${!hasDt ? "text-ink/40" : diff === 0 ? "text-secondary-dark" : "text-danger"}`}>
            {hasDt ? `${diff > 0 ? "+" : ""}${diff.toLocaleString("vi-VN")} đ` : "—"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink/60">= Doanh thu máy − (Tiền mặt + Tài khoản + Thu chi + Grab + Shopee)</p>

        {isDayEnd && (
          <div className="mt-3 rounded-xl bg-[#eef6ff] p-3 text-xs text-[#1e40af]">
            <p className="font-semibold">Ca cuối ngày – chốt xong sẽ ghi doanh thu cả ngày lên Google Sheet.</p>
            {dayBefore.map((x) => (
              <p key={x.label} className="flex justify-between"><span>{x.label}</span><span className="tabular-nums">{x.dt.toLocaleString("vi-VN")} đ{x.diff ? ` (lệch ${x.diff.toLocaleString("vi-VN")})` : ""}</span></p>
            ))}
            <p className="flex justify-between"><span>Ca này</span><span className="tabular-nums">{revenue.dt.toLocaleString("vi-VN")} đ</span></p>
            <p className="mt-1 flex justify-between border-t border-[#bfdbfe] pt-1 font-bold"><span>Tổng doanh thu ngày</span><span className="tabular-nums">{dayTotal.toLocaleString("vi-VN")} đ</span></p>
          </div>
        )}

        <Field label="Ghi chú (không bắt buộc)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: thiếu 20k do trả lại khách" />
        </Field>
        <Button className="mt-3 w-full py-3 text-base" variant="secondary" disabled={busy || !ready || device.state !== "APPROVED"} onClick={() => setShooting(true)}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />} {busy ? "Đang gửi…" : "Chốt ca & chụp ảnh"}
        </Button>
        {!ready && (
          <p className="mt-1 text-center text-xs text-ink/60">
            {missing.length ? `Nhập ${missing.map((k) => REVENUE_LABEL[k]).join(", ")}. ` : ""}
            {invalid ? "Sửa ô bị đỏ." : ""}
          </p>
        )}
      </Card>

      {shooting && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink p-4">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between text-white">
              <p className="font-bold">Chụp ảnh chốt ca</p>
              <div className="flex items-center gap-3">
                <button onClick={() => submit()} className="text-xs text-white/80 underline">Gửi không kèm ảnh</button>
                <button onClick={() => setShooting(false)} className="rounded-full p-1 hover:bg-white/10" aria-label="Huỷ">
                  <X size={22} />
                </button>
              </div>
            </div>
            <p className="text-xs text-white/70">Bấm chụp là gửi luôn vào nhóm Telegram cùng số liệu (ảnh không lưu trong app).</p>
            <PhotoCamera photos={[]} max={1} shootLabel="Chụp & gửi" onChange={(p) => p[0] && submit(p[0])} />
          </div>
        </div>
      )}
    </div>
  );
}
