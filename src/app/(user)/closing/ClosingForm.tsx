"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, Loader2, RotateCcw, Send, Sparkles, TriangleAlert, X } from "lucide-react";
import PhotoCamera from "@/components/user/PhotoCamera";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";
import { CLOSING_SHIFTS, closingSum, evalMoneyExpr, REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type ClosingShiftKey, type Revenue, type RevenueKey } from "@/lib/revenue";
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
  existing,
  ocrEnabled,
}: {
  scheduledShift: string | null; // ca được xếp lịch (để tham khảo)
  defaultShift: ClosingShiftKey;
  dates: Record<ClosingShiftKey, string>; // ngày doanh thu theo từng ca chốt
  checkIn?: string | null;
  employee?: string;
  storeName?: string;
  /** các ca đã chốt trước trong ngày (để ca cuối thấy tổng ngày) */
  dayBefore: { label: string; dt: number; diff: number }[];
  /** ca đã chốt rồi → nạp lại số để sửa (1 ca chỉ 1 bản ghi) */
  existing: Partial<Record<ClosingShiftKey, { input: Record<string, string>; note: string; at: string; by: string; total?: string }>>;
  /** đã cấu hình Gemini đọc ảnh */
  ocrEnabled: boolean;
}) {
  const router = useRouter();
  const device = useDevice();
  const load = (k: ClosingShiftKey): Raw => ({ ...EMPTY, ...(existing[k]?.input ?? {}) });
  const [shiftKey, setShiftKey] = useState<ClosingShiftKey>(defaultShift);
  const [note, setNote] = useState(existing[defaultShift]?.note ?? "");
  const [raw, setRaw] = useState<Raw>(() => load(defaultShift));
  // số TỔNG nhân viên tự cộng ghi trên tờ chốt ca → app kiểm tra cộng đúng chưa
  const [total, setTotal] = useState(existing[defaultShift]?.total ?? "");
  const [scaled, setScaled] = useState(false);
  const done = existing[shiftKey];
  const pickShift = (k: ClosingShiftKey) => {
    setShiftKey(k);
    setRaw(load(k));
    setNote(existing[k]?.note ?? "");
    setTotal(existing[k]?.total ?? "");
  };
  const isDayEnd = shiftKey === "T";
  const [busy, setBusy] = useState(false);
  const [shooting, setShooting] = useState(false); // đang mở camera chụp ảnh chốt ca
  const [result, setResult] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null); // ảnh chốt ca (chỉ gửi Telegram, không lưu)
  // kết quả đọc ảnh: found = các ô AI đọc được; date = ngày trên ảnh
  const [ocr, setOcr] = useState<
    | { state: "reading" }
    | { state: "done"; found: RevenueKey[]; date?: string; values: Partial<Revenue> }
    | { state: "error"; text: string }
    | null
  >(null);

  const evals = Object.fromEntries(REVENUE_KEYS.map((k) => [k, evalMoneyExpr(raw[k])])) as Record<RevenueKey, ReturnType<typeof evalMoneyExpr>>;
  const revenue = Object.fromEntries(REVENUE_KEYS.map((k) => [k, evals[k].value])) as Revenue;
  const diff = revenueDiff(revenue);
  const hasDt = !!raw.dt.trim();
  // DT máy do admin cấp – NV có thì ghi (DTm), không có → admin bổ sung sau. Bắt buộc: TM, TK
  const REQUIRED: RevenueKey[] = ["tm", "tk"];
  const counted = closingSum(revenue);
  const totalEval = evalMoneyExpr(total);
  const hasTotal = !!total.trim() && totalEval.ok;
  const totalDiff = hasTotal ? totalEval.value - counted : 0;
  const missing = REQUIRED.filter((k) => !raw[k].trim());
  const invalid = REVENUE_KEYS.some((k) => raw[k].trim() && !evals[k].ok) || (!!total.trim() && !totalEval.ok);
  const ready = !missing.length && !invalid;
  const dayTotal = dayBefore.reduce((s, x) => s + x.dt, 0) + revenue.dt;

  // chụp xong 1 ảnh → gửi luôn (ảnh chỉ gửi vào nhóm Telegram, không lưu)
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
      body: JSON.stringify({ photos: photo ? [photo] : [], ocr: ocr?.state === "done" ? { status: "OK", values: ocr.values } : ocr?.state === "error" ? { status: "FAILED", error: ocr.text.slice(0, 300) } : undefined, closingShift: shiftKey, note, revenue: { ...revenue, dt: hasDt ? revenue.dt : null }, staffTotal: hasTotal ? totalEval.value : null, revenueInput: raw, lat: pos?.coords.latitude, lng: pos?.coords.longitude }),
    });
    const j = await r.json().catch(() => ({ error: "Lỗi mạng" }));
    setBusy(false);
    if (!r.ok) return setResult({ tone: "red", text: j.error || "Chốt ca thất bại" });
    setResult({ tone: j.telegram === "SENT" && j.sheet !== "FAILED" ? "green" : "orange", text: [j.message, j.sheetMessage].filter(Boolean).join(" ") });
    // giữ nguyên số vừa gửi (ca này giờ đã chốt – lần sau là sửa)
    if (r.ok) {
      setPhoto(null);
      setOcr(null);
    }
    router.refresh();
  };

  // chụp xong → giữ ảnh, gửi Gemini đọc số → điền vào form (nhân viên kiểm tra, sửa rồi mới gửi)
  const onShot = async (p: string) => {
    setShooting(false);
    setPhoto(p);
    setResult(null);
    if (!ocrEnabled) return setOcr(null);
    setOcr({ state: "reading" });
    const r = await fetch("/api/closing/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos: [p] }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) return setOcr({ state: "error", text: j.error || "Không đọc được ảnh – hãy nhập tay" });
    const vals = (j.values ?? {}) as Partial<Revenue>;
    const found = REVENUE_KEYS.filter((k) => typeof vals[k] === "number");
    setRaw((o) => {
      const n = { ...o };
      for (const k of found) n[k] = k === "cp" && j.cpDetail ? String(j.cpDetail) : String(vals[k]);
      return n;
    });
    if (j.note) setNote((o) => o || String(j.note));
    if (typeof j.staffTotal === "number") setTotal(String(j.staffTotal));
    setScaled(!!j.scaled);
    setOcr({ state: "done", found, date: j.date || undefined, values: vals });
  };

  // cảnh báo thiếu thông tin cơ bản sau khi đọc ảnh: Tiền mặt, Tài khoản, Ngày
  const warnings: { text: string; fixed?: boolean }[] = [];
  if (ocr?.state === "done") {
    for (const k of ["tm", "tk"] as const)
      if (!ocr.found.includes(k)) warnings.push({ text: `Ảnh không có / không đọc được ${REVENUE_LABEL[k]}`, fixed: !!raw[k].trim() });
    if (!ocr.date) warnings.push({ text: "Không thấy ngày tháng trên ảnh – kiểm tra đúng phiếu của hôm nay" });
    else if (dates[shiftKey] && ocr.date !== dates[shiftKey])
      warnings.push({ text: `Ngày trên ảnh là ${viDate(ocr.date)}, khác ngày chốt ${viDate(dates[shiftKey])} – kiểm tra lại ảnh hoặc ca chốt` });
  }
  const openWarn = warnings.filter((w) => !w.fixed).length;

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
              onClick={() => pickShift(c.key)}
              className={`rounded-xl px-2 py-2.5 text-center text-sm ring-1 transition ${
                shiftKey === c.key ? "bg-secondary font-bold text-white ring-secondary-dark" : "bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200"
              }`}
            >
              Ca {c.name}
              {existing[c.key] && <span className="block text-[10px] font-normal opacity-80">đã chốt</span>}
            </button>
          ))}
        </div>
      </Card>

      <Card title="Ảnh chốt ca">
        {!photo ? (
          <>
            <p className="mb-2 text-xs text-ink/70">
              {ocrEnabled
                ? "Chụp phiếu / màn hình doanh thu cuối ca – AI sẽ đọc và điền sẵn số liệu bên dưới để bạn kiểm tra."
                : "Chụp phiếu / màn hình doanh thu cuối ca để gửi kèm vào nhóm (chưa bật AI đọc ảnh – nhập số bằng tay)."}
            </p>
            <Button className="w-full py-3 text-base" variant="secondary" disabled={busy || device.state !== "APPROVED"} onClick={() => setShooting(true)}>
              <Camera size={18} /> Chụp ảnh chốt ca
            </Button>
          </>
        ) : (
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="Ảnh chốt ca" className="h-24 w-20 shrink-0 rounded-lg object-cover ring-1 ring-ink/10" />
            <div className="min-w-0 flex-1 space-y-1.5 text-sm">
              {ocr?.state === "reading" && (
                <p className="flex items-center gap-1.5 text-accent"><Loader2 size={16} className="animate-spin" /> Đang đọc ảnh bằng AI…</p>
              )}
              {ocr?.state === "error" && <p className="text-danger">{ocr.text}</p>}
              {ocr?.state === "done" && (
                <p className="flex items-center gap-1.5 text-secondary-dark">
                  <Sparkles size={16} /> Đã điền {ocr.found.length} ô từ ảnh{ocr.date ? ` · ngày ${viDate(ocr.date)}` : ""}. Kiểm tra lại trước khi gửi.
                </p>
              )}
              {!ocr && <p className="text-ink/70">Ảnh sẽ gửi kèm vào nhóm Telegram.</p>}
              <button type="button" disabled={busy || ocr?.state === "reading"} onClick={() => setShooting(true)} className="flex items-center gap-1 text-xs text-accent underline disabled:opacity-50">
                <RotateCcw size={13} /> Chụp lại
              </button>
            </div>
          </div>
        )}
        {warnings.length > 0 && (
          <ul className={`mt-3 space-y-1 rounded-xl px-3 py-2 text-xs ${openWarn ? "bg-[#fde2e2] text-danger" : "bg-[#e3f3e7] text-secondary-dark"}`}>
            {warnings.map((w) => (
              <li key={w.text} className={`flex gap-1.5 ${w.fixed ? "text-secondary-dark" : ""}`}>
                {w.fixed ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <TriangleAlert size={14} className="mt-px shrink-0" />}
                <span>{w.text}{w.fixed ? " – đã nhập tay" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Số liệu ca">
        {done && (
          <p className="mb-3 rounded-lg bg-[#fff4e5] px-3 py-2 text-xs text-warn">
            Ca này đã chốt lúc <b>{done.at}</b>{done.by ? ` (${done.by})` : ""}. Lần này sẽ <b>sửa lại</b> bản chốt đó và gửi bản cập nhật vào nhóm.
          </p>
        )}
        {ocr?.state === "done" && scaled && (
          <p className="mb-2 rounded-lg bg-[#eef6ff] px-3 py-1.5 text-[11px] text-[#1e40af]">Tờ ghi theo đơn vị nghìn (VD 2487 = 2.487.000đ) → đã tự nhân 1000, kiểm tra lại.</p>
        )}
        <p className="mb-3 text-xs text-ink/70">Gõ được phép cộng, VD <b>10000 + 20000 + 20k</b>. Rời ô sẽ tự hiện tổng. Ô có * bắt buộc (không có thì nhập 0), ô khác bỏ trống = 0.</p>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {REVENUE_KEYS.map((k) => (
            <div key={k} className={k === "dt" || k === "cp" ? "col-span-2" : ""}>
              <Field label={`${REVENUE_LABEL[k]}${REQUIRED.includes(k) ? " *" : ""}`}>
                <ExprMoneyInput
                  value={raw[k]}
                  onChange={(v) => setRaw((o) => ({ ...o, [k]: v }))}
                  placeholder={k === "dt" ? "Nếu có DTm – không có để trống" : HINT[k]}
                  aria-label={REVENUE_LABEL[k]}
                />
              </Field>
            </div>
          ))}
        </div>

        {/* kiểm tra tổng NV tự cộng trên tờ chốt ca */}
        <div className="mt-3 rounded-xl bg-cream px-3 py-2">
          <Field label="Tổng NV ghi trên tờ (số cuối)">
            <ExprMoneyInput value={total} onChange={setTotal} placeholder="Số tổng cuối tờ chốt ca" aria-label="Tổng nhân viên ghi" />
          </Field>
          <div className="mt-1.5 flex items-center justify-between text-sm">
            <span className="text-ink/70">App cộng lại (TM + TK + Thu chi + Grab + Shopee)</span>
            <span className="font-semibold tabular-nums">{counted.toLocaleString("vi-VN")} đ</span>
          </div>
          {hasTotal && (
            <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${totalDiff === 0 ? "text-secondary-dark" : "text-danger"}`}>
              {totalDiff === 0 ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
              {totalDiff === 0
                ? "Tổng ghi trên tờ cộng ĐÚNG"
                : `Cộng SAI: tờ ghi ${totalEval.value.toLocaleString("vi-VN")}, đúng là ${counted.toLocaleString("vi-VN")} (lệch ${totalDiff > 0 ? "+" : ""}${totalDiff.toLocaleString("vi-VN")})`}
            </p>
          )}
        </div>

        <div className={`mt-3 flex items-center justify-between rounded-xl px-3 py-2 ${!hasDt ? "bg-cream" : diff === 0 ? "bg-[#e3f3e7]" : "bg-[#fde2e2]"}`}>
          <span className="text-sm font-semibold">Âm / Dương</span>
          <span className={`text-lg font-bold tabular-nums ${!hasDt ? "text-ink/40" : diff === 0 ? "text-secondary-dark" : "text-danger"}`}>
            {hasDt ? `${diff > 0 ? "+" : ""}${diff.toLocaleString("vi-VN")} đ` : "—"}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-ink/60">
          {hasDt ? "= Doanh thu máy − (Tiền mặt + Tài khoản + Thu chi + Grab + Shopee)" : "Chưa có Doanh thu máy (DTm) – admin sẽ bổ sung rồi tính âm/dương."}
        </p>

        {isDayEnd && (
          <div className="mt-3 rounded-xl bg-[#eef6ff] p-3 text-xs text-[#1e40af]">
            <p className="font-semibold">Ca cuối ngày – chốt xong sẽ ghi doanh thu cả ngày lên Google Sheet.</p>
            {dayBefore.map((x) => (
              <p key={x.label} className="flex justify-between"><span>{x.label}</span><span className="tabular-nums">{x.dt.toLocaleString("vi-VN")} đ{x.diff ? ` (lệch ${x.diff.toLocaleString("vi-VN")})` : ""}</span></p>
            ))}
            <p className="flex justify-between"><span>Ca này</span><span className="tabular-nums">{hasDt ? `${revenue.dt.toLocaleString("vi-VN")} đ` : "chưa có DT máy"}</span></p>
            <p className="mt-1 flex justify-between border-t border-[#bfdbfe] pt-1 font-bold"><span>Tổng doanh thu ngày</span><span className="tabular-nums">{dayTotal.toLocaleString("vi-VN")} đ</span></p>
          </div>
        )}

        <Field label="Ghi chú (không bắt buộc)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: thiếu 20k do trả lại khách" />
        </Field>
        <Button
          className="mt-3 w-full py-3 text-base"
          variant="secondary"
          disabled={busy || !ready || ocr?.state === "reading" || device.state !== "APPROVED"}
          onClick={() => submit()}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang gửi…" : done ? "Cập nhật chốt ca & gửi nhóm" : "Chốt ca & gửi nhóm"}
        </Button>
        {(!ready || !photo) && (
          <p className="mt-1 text-center text-xs text-ink/60">
            {missing.length ? `Nhập ${missing.map((k) => REVENUE_LABEL[k]).join(", ")}. ` : ""}
            {invalid ? "Sửa ô bị đỏ. " : ""}
            {!photo ? "Chưa có ảnh – sẽ gửi không kèm ảnh." : ""}
          </p>
        )}
      </Card>

      {shooting && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink p-4">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between text-white">
              <p className="font-bold">Chụp ảnh chốt ca</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setShooting(false)} className="rounded-full p-1 hover:bg-white/10" aria-label="Huỷ">
                  <X size={22} />
                </button>
              </div>
            </div>
            <p className="text-xs text-white/70">
              Chụp rõ, đủ sáng, thấy cả <b>ngày</b>, <b>tiền mặt</b>, <b>tài khoản</b>. {ocrEnabled ? "AI đọc xong sẽ điền sẵn để bạn kiểm tra." : ""} Ảnh chỉ gửi vào nhóm Telegram, không lưu trong app.
            </p>
            <PhotoCamera photos={[]} max={1} shootLabel={ocrEnabled ? "Chụp & đọc số" : "Chụp"} onChange={(p) => p[0] && onShot(p[0])} />
          </div>
        </div>
      )}
    </div>
  );
}
