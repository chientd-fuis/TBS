"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, CheckCircle2, ImageUp, Loader2, Send, Sparkles, TriangleAlert, X } from "lucide-react";
import PhotoCamera from "@/components/user/PhotoCamera";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { ALLOCATIONS, EXPENSE_CATEGORIES } from "@/lib/finance";
import { evalMoneyExpr } from "@/lib/revenue";
import { addDays } from "@/lib/time";

type StoreOpt = { id: string; name: string };
export type ExpenseInitial = {
  id?: string;
  date: string;
  amount: string;
  category: string;
  vendor: string;
  items: string;
  note: string;
  scope: "STORE" | "SHARED";
  storeId: string;
  allocation: string;
  shares: Record<string, string>;
  paidFrom: "OWNER" | "CASHBOX";
};

/** Ảnh chọn từ máy → nén JPEG cạnh dài ≤ 1600px (giống ảnh chụp camera). */
async function fileToJpeg(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Không đọc được ảnh (thử ảnh JPG/PNG)"));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const pill = (on: boolean) =>
  `rounded-xl px-3 py-2 text-sm ring-1 transition ${on ? "bg-secondary font-bold text-white ring-secondary-dark" : "bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200"}`;

export default function ExpenseForm({
  stores,
  today,
  initial,
  ocrEnabled,
  autoShoot = false,
  onDone,
}: {
  stores: StoreOpt[];
  today: string;
  initial: ExpenseInitial;
  ocrEnabled: boolean;
  /** mở camera ngay khi vào trang (nút "Nhập bill chi phí" ở Tổng quan) */
  autoShoot?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<ExpenseInitial>(initial);
  const set = <K extends keyof ExpenseInitial>(k: K, v: ExpenseInitial[K]) => setF((o) => ({ ...o, [k]: v }));
  const [photo, setPhoto] = useState<string | null>(null);
  const [shooting, setShooting] = useState(autoShoot);
  const [ocr, setOcr] = useState<{ state: "reading" } | { state: "done"; amount?: number; date?: string } | { state: "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const editing = !!f.id;

  const amt = evalMoneyExpr(f.amount);
  const sharesSum = Object.values(f.shares).reduce((s, v) => s + (Number(v.replace(",", ".")) || 0), 0);

  const readPhoto = async (p: string) => {
    setShooting(false);
    setPhoto(p);
    setMsg(null);
    if (!ocrEnabled) return;
    setOcr({ state: "reading" });
    const r = await fetch("/api/admin/expenses/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: p }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) return setOcr({ state: "error", text: j.error || "Không đọc được bill – nhập tay" });
    setF((o) => ({
      ...o,
      ...(j.amount ? { amount: String(j.amount) } : {}),
      ...(j.date ? { date: j.date } : {}),
      ...(j.vendor ? { vendor: j.vendor } : {}),
      ...(j.items ? { items: j.items } : {}),
      ...(j.category ? { category: j.category } : {}),
    }));
    setOcr({ state: "done", amount: j.amount, date: j.date });
  };

  const onFile = async (file?: File | null) => {
    if (!file) return;
    try {
      await readPhoto(await fileToJpeg(file));
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    }
  };

  // cảnh báo sau khi đọc bill: thiếu số tiền / ngày, ngày lạ
  const warnings: { text: string; fixed?: boolean }[] = [];
  if (ocr?.state === "done") {
    if (!ocr.amount) warnings.push({ text: "Bill không có / không đọc được số tiền", fixed: amt.ok && amt.value > 0 });
    if (!ocr.date) warnings.push({ text: "Bill không có ngày – đang dùng ngày đã chọn, kiểm tra lại", fixed: false });
  }
  if (f.date > today) warnings.push({ text: "Ngày chi ở tương lai – kiểm tra lại" });
  else if (f.date && f.date < addDays(today, -31)) warnings.push({ text: "Ngày chi cách đây hơn 1 tháng – kiểm tra lại" });

  const ready = amt.ok && amt.value > 0 && !!f.date && !!f.category && (f.scope === "SHARED" || !!f.storeId) && (f.scope !== "SHARED" || f.allocation !== "CUSTOM" || sharesSum > 0);

  const save = async (allowDuplicate = false) => {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/expenses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: f.id,
        photo: photo ?? undefined,
        date: f.date,
        amount: amt.value,
        category: f.category,
        vendor: f.vendor,
        items: f.items,
        note: f.note,
        scope: f.scope,
        storeId: f.scope === "STORE" ? f.storeId : undefined,
        allocation: f.allocation,
        customShares: stores.map((s) => ({ storeId: s.id, pct: Number((f.shares[s.id] ?? "").replace(",", ".")) || 0 })),
        paidFrom: f.paidFrom,
        allowDuplicate,
        ocr: ocr?.state === "done" ? { status: "OK", amount: ocr.amount, date: ocr.date } : ocr?.state === "error" ? { status: "FAILED" } : undefined,
      }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Lỗi mạng" };
    setBusy(false);
    if (r?.status === 409 && j.code === "DUPLICATE") return setDup(j.error);
    if (!r || !r.ok) return setMsg({ tone: "red", text: j.error || "Lưu thất bại" });
    setMsg({ tone: j.telegram === "SENT" ? "green" : "orange", text: j.message });
    setPhoto(null);
    setOcr(null);
    if (!editing) setF((o) => ({ ...initial, date: o.date, scope: o.scope, storeId: o.storeId, paidFrom: o.paidFrom }));
    router.refresh();
    onDone?.();
  };

  return (
    <div className="space-y-3">
      {msg && (
        <Alert tone={msg.tone}>
          {msg.tone === "green" ? <CheckCircle2 size={16} className="mr-1 inline" /> : <TriangleAlert size={16} className="mr-1 inline" />}
          {msg.text}
        </Alert>
      )}

      {/* Ảnh bill */}
      {!photo ? (
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" className="py-3" onClick={() => setShooting(true)} disabled={busy}>
            <Camera size={18} /> Chụp bill
          </Button>
          <Button type="button" variant="outline" className="py-3" onClick={() => fileRef.current?.click()} disabled={busy}>
            <ImageUp size={18} /> Chọn ảnh
          </Button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
          <p className="col-span-2 text-xs text-ink/60">
            {ocrEnabled ? "AI đọc bill → điền sẵn số tiền, ngày, nơi bán, danh mục để bạn kiểm tra." : "Chưa bật AI đọc bill (GEMINI_API_KEY) – ảnh chỉ gửi kèm vào nhóm, số liệu nhập tay."}{" "}
            Ảnh gửi vào nhóm Telegram Quản lý doanh thu, không lưu trong app. Không có bill thì nhập tay bên dưới.
          </p>
        </div>
      ) : (
        <div className="flex gap-3 rounded-xl bg-cream p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="Ảnh bill" className="h-24 w-20 shrink-0 rounded-lg object-cover ring-1 ring-ink/10" />
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">
            {ocr?.state === "reading" && <p className="flex items-center gap-1.5 text-accent"><Loader2 size={16} className="animate-spin" /> Đang đọc bill bằng AI…</p>}
            {ocr?.state === "error" && <p className="text-danger">{ocr.text}</p>}
            {ocr?.state === "done" && <p className="flex items-center gap-1.5 text-secondary-dark"><Sparkles size={16} /> Đã điền từ bill – kiểm tra lại trước khi lưu.</p>}
            {!ocr && <p className="text-ink/70">Ảnh sẽ gửi kèm vào nhóm Telegram.</p>}
            <button type="button" onClick={() => { setPhoto(null); setOcr(null); }} className="flex items-center gap-1 text-xs text-accent underline">
              <X size={13} /> Bỏ ảnh
            </button>
          </div>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-[#fde2e2] px-3 py-2 text-xs text-danger">
          {warnings.map((w) => (
            <li key={w.text} className={`flex gap-1.5 ${w.fixed ? "text-secondary-dark" : ""}`}>
              {w.fixed ? <CheckCircle2 size={14} className="mt-px shrink-0" /> : <TriangleAlert size={14} className="mt-px shrink-0" />}
              <span>{w.text}{w.fixed ? " – đã nhập tay" : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Ngày chi *">
          <Input type="date" value={f.date} max={addDays(today, 1)} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Số tiền *">
          <ExprMoneyInput value={f.amount} onChange={(v) => set("amount", v)} placeholder="VD: 1tr2 hoặc 500k + 30k" aria-label="Số tiền" />
        </Field>
        <div className="col-span-2">
          <Field label="Danh mục *">
            <Select value={f.category} onChange={(e) => set("category", e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </Select>
          </Field>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-accent">Tính cho</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={pill(f.scope === "STORE")} onClick={() => set("scope", "STORE")}>1 cơ sở</button>
          <button type="button" className={pill(f.scope === "SHARED")} onClick={() => set("scope", "SHARED")}>Chung các cơ sở</button>
        </div>
        {f.scope === "STORE" ? (
          <Select className="mt-2" value={f.storeId} onChange={(e) => set("storeId", e.target.value)} aria-label="Cơ sở">
            <option value="">– Chọn cơ sở –</option>
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : (
          <div className="mt-2 space-y-2">
            <Select value={f.allocation} onChange={(e) => set("allocation", e.target.value)} aria-label="Cách chia">
              {ALLOCATIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </Select>
            {f.allocation === "REVENUE" && <p className="text-[11px] text-ink/60">Chia theo doanh thu từ đầu tháng của từng cơ sở – cơ sở bán nhiều chịu nhiều.</p>}
            {f.allocation === "CUSTOM" && (
              <div className="grid grid-cols-3 gap-2">
                {stores.map((s) => (
                  <Field key={s.id} label={`${s.name.replace(/^TBS\s*/i, "")} %`}>
                    <Input inputMode="decimal" value={f.shares[s.id] ?? ""} onChange={(e) => set("shares", { ...f.shares, [s.id]: e.target.value })} />
                  </Field>
                ))}
                <p className={`col-span-3 text-[11px] ${sharesSum === 100 ? "text-ink/60" : "text-warn"}`}>Tổng {sharesSum}% {sharesSum !== 100 && "(sẽ tự quy đổi theo tỷ lệ)"}</p>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold text-accent">Nguồn tiền</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={pill(f.paidFrom === "OWNER")} onClick={() => set("paidFrom", "OWNER")}>Chủ trả / chuyển khoản</button>
          <button type="button" className={pill(f.paidFrom === "CASHBOX")} onClick={() => set("paidFrom", "CASHBOX")}>Tiền két</button>
        </div>
        {f.paidFrom === "CASHBOX" && <p className="mt-1 text-[11px] text-warn">Tiền két đã nằm trong ô &quot;Thu chi&quot; khi chốt ca → chỉ lưu chứng từ, không cộng thêm vào chi phí.</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <Field label="Nơi bán">
          <Input value={f.vendor} maxLength={120} onChange={(e) => set("vendor", e.target.value)} placeholder="VD: Bách hoá XANH" />
        </Field>
        <Field label="Nội dung">
          <Input value={f.items} maxLength={300} onChange={(e) => set("items", e.target.value)} placeholder="VD: Sữa đặc x5" />
        </Field>
        <div className="col-span-2">
          <Field label="Ghi chú">
            <Textarea rows={2} value={f.note} maxLength={500} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
      </div>

      <Button type="button" variant="secondary" className="w-full py-3 text-base" disabled={busy || !ready || ocr?.state === "reading"} onClick={() => save()}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang lưu…" : editing ? "Lưu thay đổi & báo nhóm" : "Lưu & gửi nhóm"}
      </Button>
      {!ready && <p className="text-center text-xs text-ink/60">Nhập ngày, số tiền{f.scope === "STORE" ? ", chọn cơ sở" : ""}.</p>}

      {shooting && (
        <div className="fixed inset-0 z-50 flex flex-col bg-ink p-4">
          <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex items-center justify-between text-white">
              <p className="font-bold">Chụp bill chi phí</p>
              <button onClick={() => setShooting(false)} className="rounded-full p-1 hover:bg-white/10" aria-label="Huỷ"><X size={22} /></button>
            </div>
            <p className="text-xs text-white/70">Chụp thẳng, đủ sáng, thấy rõ <b>tổng tiền</b> và <b>ngày</b>.</p>
            <PhotoCamera photos={[]} max={1} shootLabel={ocrEnabled ? "Chụp & đọc bill" : "Chụp"} onChange={(p) => p[0] && readPhoto(p[0])} />
          </div>
        </div>
      )}
      <ConfirmDialog open={!!dup} title="Có thể bị trùng bill" confirmLabel="Vẫn lưu" busy={busy} onCancel={() => setDup(null)} onConfirm={() => { setDup(null); save(true); }}>
        <p>{dup}</p>
        <p>Bạn vẫn muốn lưu khoản chi này?</p>
      </ConfirmDialog>
    </div>
  );
}
