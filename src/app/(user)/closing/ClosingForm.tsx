"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send, TriangleAlert } from "lucide-react";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";
import { evalMoneyExpr, REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type Revenue, type RevenueKey } from "@/lib/revenue";

type Raw = Record<RevenueKey, string>;
const EMPTY: Raw = { dt: "", tm: "", tk: "", cp: "", grab: "", shopee: "" };
const HINT: Partial<Record<RevenueKey, string>> = { cp: "VD: 30k sữa chua + 20k ship" };

export default function ClosingForm({
  shiftLabel,
  checkIn,
  employee,
  storeName,
  isDayEnd,
  dayBefore,
}: {
  shiftLabel: string | null;
  checkIn?: string | null;
  employee?: string;
  storeName?: string;
  isDayEnd: boolean;
  /** các ca đã chốt trước trong ngày (để ca cuối thấy tổng ngày) */
  dayBefore: { label: string; dt: number; diff: number }[];
}) {
  const router = useRouter();
  const device = useDevice();
  const [note, setNote] = useState("");
  const [raw, setRaw] = useState<Raw>(EMPTY);
  const [busy, setBusy] = useState(false);
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

  const submit = async () => {
    setBusy(true);
    setResult(null);
    let pos: GeolocationPosition | null = null;
    try {
      pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
    } catch {}
    const r = await fetch("/api/closing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note, revenue, revenueInput: raw, lat: pos?.coords.latitude, lng: pos?.coords.longitude }),
    });
    const j = await r.json().catch(() => ({ error: "Lỗi mạng" }));
    setBusy(false);
    if (!r.ok) return setResult({ tone: "red", text: j.error || "Chốt ca thất bại" });
    setResult({ tone: j.telegram === "SENT" && j.sheet !== "FAILED" ? "green" : "orange", text: [j.message, j.sheetMessage].filter(Boolean).join(" ") });
    setNote("");
    setRaw(EMPTY);
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
          <dt className="text-ink/60">Ca</dt><dd className="font-semibold">{shiftLabel || "—"}</dd>
          <dt className="text-ink/60">Vào ca</dt><dd>{checkIn || "Chưa check-in"}</dd>
        </dl>
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
        <Button className="mt-3 w-full py-3 text-base" variant="secondary" disabled={busy || !ready || device.state !== "APPROVED"} onClick={submit}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang gửi…" : "Chốt ca & gửi nhóm"}
        </Button>
        {!ready && (
          <p className="mt-1 text-center text-xs text-ink/60">
            {missing.length ? `Nhập ${missing.map((k) => REVENUE_LABEL[k]).join(", ")}. ` : ""}
            {invalid ? "Sửa ô bị đỏ." : ""}
          </p>
        )}
      </Card>
    </div>
  );
}
