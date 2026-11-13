"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, ImageUp, Loader2, Send, Sparkles, X } from "lucide-react";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { closingSum, evalMoneyExpr, REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type Revenue, type RevenueKey } from "@/lib/revenue";

type StoreOpt = { id: string; name: string; staff: { id: string; name: string }[]; missing: string[] };
type Raw = Record<RevenueKey, string>;
const SHIFTS = [
  { key: "S", name: "Sáng" },
  { key: "C", name: "Chiều" },
  { key: "T", name: "Tối" },
] as const;
const EMPTY: Raw = { dt: "", tm: "", tk: "", cp: "", grab: "", shopee: "" };
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const vnd = (n: number) => n.toLocaleString("vi-VN");

/** Ảnh tờ chốt ca: thu nhỏ còn JPEG ≤ 1600px (server nhận ≤ 1,5 MB). */
async function fileToJpeg(file: File, maxSide = 1600): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Không đọc được ảnh ${file.name}`));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Admin nhập bù chốt ca còn thiếu: chọn cơ sở / ngày / ca → tải ảnh tờ chốt ca → AI đọc số → kiểm tra → lưu.
 * existing: "storeId|YYYY-MM-DD" → các ca đã chốt.
 */
export default function AddClosing({ stores, existing, today, ocrEnabled }: { stores: StoreOpt[]; existing: Record<string, string[]>; today: string; ocrEnabled: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const store = stores.find((s) => s.id === storeId);
  const [date, setDate] = useState(store?.missing[0] ?? today);
  const [shift, setShift] = useState<"S" | "C" | "T">("T");
  const [userId, setUserId] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [raw, setRaw] = useState<Raw>(EMPTY);
  const [total, setTotal] = useState("");
  const [note, setNote] = useState("");
  const [sendTelegram, setSendTelegram] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [ocr, setOcr] = useState<{ state: "reading" } | { state: "done"; date?: string; values: Partial<Revenue>; scaled?: boolean } | { state: "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);

  const done = existing[`${storeId}|${date}`] ?? [];
  const shiftName = SHIFTS.find((s) => s.key === shift)!.name;
  const exists = done.includes(shiftName);
  const evals = useMemo(() => Object.fromEntries(REVENUE_KEYS.map((k) => [k, evalMoneyExpr(raw[k])])) as Record<RevenueKey, ReturnType<typeof evalMoneyExpr>>, [raw]);
  const revenue = Object.fromEntries(REVENUE_KEYS.map((k) => [k, evals[k].value])) as Revenue;
  const hasDt = !!raw.dt.trim();
  const thu = revenue.tm + revenue.tk + revenue.grab + revenue.shopee + revenue.cp; // DT thật
  const totalEval = evalMoneyExpr(total);
  const hasTotal = !!total.trim() && totalEval.ok;
  const totalDiff = hasTotal ? totalEval.value - closingSum(revenue) : 0;
  const missingReq = (["tm", "tk"] as const).filter((k) => !raw[k].trim());
  const invalid = REVENUE_KEYS.some((k) => raw[k].trim() && !evals[k].ok) || (!!total.trim() && !totalEval.ok);
  const ready = !!storeId && !missingReq.length && !invalid && (!exists || overwrite);

  const reset = (keepPlace = true) => {
    setPhotos([]);
    setRaw(EMPTY);
    setTotal("");
    setNote("");
    setOcr(null);
    setOverwrite(false);
    if (!keepPlace) setUserId("");
  };
  const pickStore = (id: string) => {
    setStoreId(id);
    setUserId("");
    const s = stores.find((x) => x.id === id);
    if (s?.missing[0]) setDate(s.missing[0]);
    setMsg(null);
  };

  async function onFiles(files: File[]) {
    if (!files.length) return;
    setMsg(null);
    let list: string[];
    try {
      list = [...photos, ...(await Promise.all(files.slice(0, 4 - photos.length).map((f) => fileToJpeg(f))))].slice(0, 4);
    } catch (e) {
      return setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
    setPhotos(list);
    if (!ocrEnabled) return;
    setOcr({ state: "reading" });
    const r = await fetch("/api/admin/closing/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photos: list, store: storeId, workDate: date }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) return setOcr({ state: "error", text: j.error || "Không đọc được ảnh – hãy nhập tay" });
    const vals = (j.values ?? {}) as Partial<Revenue>;
    setRaw((o) => {
      const n = { ...o };
      for (const k of REVENUE_KEYS) if (typeof vals[k] === "number") n[k] = k === "cp" && j.cpDetail ? String(j.cpDetail) : String(vals[k]);
      return n;
    });
    if (typeof j.staffTotal === "number") setTotal(String(j.staffTotal));
    if (j.note) setNote((o) => o || String(j.note));
    setOcr({ state: "done", date: j.date || undefined, values: vals, scaled: !!j.scaled });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/closing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        storeId,
        workDate: date,
        shift,
        userId: userId || undefined,
        photos,
        sendTelegram,
        overwrite,
        note,
        revenue: { ...revenue, dt: hasDt ? revenue.dt : null },
        staffTotal: hasTotal ? totalEval.value : null,
        revenueInput: raw,
        ocr: ocr?.state === "done" ? { status: "OK", values: ocr.values } : ocr?.state === "error" ? { status: "FAILED", error: ocr.text.slice(0, 300) } : undefined,
      }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Lỗi mạng" };
    setBusy(false);
    if (!r || !r.ok) return setMsg({ tone: "red", text: j.error || "Lưu chưa được" });
    const tg = j.telegram === "SENT" ? "đã gửi nhóm Telegram" : j.telegram === "FAILED" ? "gửi Telegram lỗi (hệ thống tự gửi lại)" : "không gửi Telegram";
    const sh = j.sheet === "SENT" ? " · đã ghi Google Sheet" : j.sheet === "FAILED" ? " · ghi Google Sheet lỗi (tự ghi lại)" : "";
    setMsg({ tone: j.telegram === "FAILED" || j.sheet === "FAILED" ? "orange" : "green", text: `${j.updated ? "Đã ghi đè" : "Đã thêm"} chốt ca ${shiftName} ${dm(date)} – ${tg}${sh}.` });
    reset();
    router.refresh();
  }

  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <CalendarPlus size={16} /> Nhập bù chốt ca còn thiếu
        {stores.some((s) => s.missing.length) && <span className="rounded-full bg-danger px-1.5 text-xs font-bold text-white">{stores.reduce((n, s) => n + s.missing.length, 0)}</span>}
      </Button>
    );

  const ocrDateDiff = ocr?.state === "done" && ocr.date && ocr.date.slice(5) !== date.slice(5);
  return (
    <div className="space-y-3 rounded-2xl border border-ink/10 bg-card p-4">
      <div className="flex items-center justify-between">
        <b>Nhập bù chốt ca</b>
        <button type="button" className="flex items-center gap-1 text-xs text-ink/60 hover:text-danger" onClick={() => (setOpen(false), reset(false), setMsg(null))}>
          <X size={14} /> Đóng
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Cơ sở">
          <Select value={storeId} onChange={(e) => pickStore(e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.missing.length ? ` (thiếu ${s.missing.length})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ngày">
          <Input type="date" value={date} max={today} onChange={(e) => (setDate(e.target.value), setOverwrite(false))} />
        </Field>
        <Field label="Ca chốt">
          <div className="flex gap-1">
            {SHIFTS.map((s) => {
              const has = done.includes(s.name);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => (setShift(s.key), setOverwrite(false))}
                  className={`flex-1 whitespace-nowrap rounded-xl border px-1 py-2 text-sm font-semibold ${shift === s.key ? "border-secondary bg-secondary text-white" : "border-ink/15 bg-card text-ink/80"}`}
                  title={has ? "Đã có người chốt" : "Chưa chốt"}
                >
                  {s.name}
                  {has && " ✓"}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Người chốt (không bắt buộc)">
          <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— Không rõ —</option>
            {store?.staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {!!store?.missing.length && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink/60">Ngày chưa chốt ca Tối (45 ngày):</span>
          {store.missing.slice(0, 20).map((d) => (
            <button key={d} type="button" onClick={() => (setDate(d), setShift("T"), setOverwrite(false))} className={`rounded-full border px-2 py-0.5 ${d === date ? "border-danger bg-danger text-white" : "border-danger/40 text-danger hover:bg-bad-bg"}`}>
              {dm(d)}
            </button>
          ))}
          {store.missing.length > 20 && <span className="text-ink/50">+{store.missing.length - 20}</span>}
        </div>
      )}
      {exists && (
        <Alert tone="orange">
          Ca {shiftName} {dm(date)} đã có người chốt – sửa số ở danh sách bên dưới, hoặc{" "}
          <label className="inline-flex items-center gap-1 font-semibold">
            <input type="checkbox" className="accent-danger" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> ghi đè bằng số mới
          </label>
        </Alert>
      )}

      {/* Ảnh */}
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <div key={i} className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p} alt="" className="h-20 w-16 rounded-lg object-cover" />
            <button type="button" className="absolute -right-1.5 -top-1.5 rounded-full bg-card p-0.5 shadow" onClick={() => setPhotos((x) => x.filter((_, k) => k !== i))}>
              <X size={12} />
            </button>
          </div>
        ))}
        {photos.length < 4 && (
          <Button type="button" variant="outline" disabled={ocr?.state === "reading"} onClick={() => fileRef.current?.click()}>
            {ocr?.state === "reading" ? <Loader2 size={16} className="animate-spin" /> : <ImageUp size={16} />} {photos.length ? "Thêm ảnh" : "Tải ảnh tờ chốt ca"}
          </Button>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles([...(e.target.files ?? [])])} />
        {ocr?.state === "reading" && <span className="text-xs text-ink/60">AI đang đọc ảnh…</span>}
        {!ocrEnabled && <span className="text-xs text-ink/50">Chưa cấu hình GEMINI_API_KEY – nhập số tay</span>}
      </div>
      {ocr?.state === "done" && (
        <Alert tone={ocrDateDiff ? "orange" : "green"}>
          <Sparkles size={14} className="inline" /> AI đã điền số – kiểm tra lại trước khi lưu.
          {ocr.scaled && " Số trên tờ ghi theo nghìn → đã nhân 1.000."}
          {ocrDateDiff && (
            <>
              {" "}
              Ngày trên ảnh là <b>{dm(ocr.date!)}</b>, khác ngày đang chọn ({dm(date)}).{" "}
              <button type="button" className="font-semibold underline" onClick={() => setDate(`${date.slice(0, 4)}-${ocr.date!.slice(5)}`)}>
                Dùng ngày trên ảnh
              </button>
            </>
          )}
          {ocr.state === "done" && !ocr.date && " Không thấy ngày trên ảnh."}
        </Alert>
      )}
      {ocr?.state === "error" && <Alert tone="orange">{ocr.text}</Alert>}

      {/* Số liệu */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {REVENUE_KEYS.map((k) => (
          <Field key={k} label={`${REVENUE_LABEL[k]}${k === "tm" || k === "tk" ? " *" : ""}`}>
            <ExprMoneyInput value={raw[k]} onChange={(v) => setRaw((o) => ({ ...o, [k]: v }))} placeholder={k === "dt" ? "admin cấp – có thì nhập" : k === "cp" ? "VD 30k sữa chua + 20k ship" : "0"} />
          </Field>
        ))}
        <Field label="Tổng NV ghi trên tờ">
          <ExprMoneyInput value={total} onChange={setTotal} placeholder="số tổng cuối tờ" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl bg-cream px-3 py-2 text-sm">
        <span>
          DT thật: <b>{vnd(thu)}</b>
        </span>
        {hasDt && (
          <span className={revenueDiff(revenue) === 0 ? "text-good" : "text-warn"}>
            Âm/Dương (DT máy − DT thật): <b>{vnd(revenue.dt - thu)}</b>
          </span>
        )}
        {hasTotal && <span className={totalDiff === 0 ? "text-good" : "text-danger"}>{totalDiff === 0 ? "✅ Tổng NV cộng đúng" : `⚠️ Tổng NV ghi lệch ${vnd(totalDiff)}`}</span>}
        {shift === "T" && <span className="text-ink/60">Ca Tối = doanh thu cả ngày → ghi Google Sheet</span>}
      </div>
      <Field label="Ghi chú">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="accent-secondary" checked={sendTelegram} onChange={(e) => setSendTelegram(e.target.checked)} /> Gửi vào nhóm Telegram của cơ sở{photos.length ? " (kèm ảnh)" : ""}
      </label>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={!ready || busy} onClick={save}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />} Lưu chốt ca {shiftName} {dm(date)}
        </Button>
        {!!missingReq.length && <span className="text-xs text-danger">Nhập {missingReq.map((k) => REVENUE_LABEL[k]).join(", ")}</span>}
        {invalid && <span className="text-xs text-danger">Có ô số chưa hợp lệ</span>}
      </div>
    </div>
  );
}
