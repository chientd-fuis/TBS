"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ImageUp, Loader2, Plus, Send, Sparkles, TriangleAlert, X } from "lucide-react";
import ExprMoneyInput from "@/components/ExprMoneyInput";
import { Alert, Button, Input, Select } from "@/components/ui";
import { defaultCountInCost, EXPENSE_CATEGORIES, txKey } from "@/lib/finance";
import { evalMoneyExpr } from "@/lib/revenue";
import { viDate } from "@/lib/time";

type StoreOpt = { id: string; name: string };
type Img = { id: number; data: string; state: "reading" | "done" | "error"; count?: number; error?: string };
type Row = {
  key: string;
  include: boolean;
  date: string;
  amount: string;
  content: string; // nội dung chi tiết = nội dung CK
  recipient: string; // giữ để lưu, không hiện
  category: string;
  countInCost: boolean; // tính vào chi phí lãi lỗ
  salaryHint?: string;
  dupHint?: string;
  fromOcr: boolean;
  img?: number;
};
type Tx = { date?: string; time?: string; amount: number; recipient?: string; transferNote?: string; purpose?: string; category?: string; salaryHint?: string; dupHint?: string };

/** Ảnh sao kê thường dài + chữ nhỏ → giữ cạnh dài tới 2400px để AI đọc rõ. */
async function fileToJpeg(file: File, maxSide = 2400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Không đọc được ảnh ${file.name} (dùng JPG/PNG)`));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let seq = 0;
const newKey = () => `r${++seq}`;

export default function StatementImport({ today, ocrEnabled }: { stores?: StoreOpt[]; today: string; ocrEnabled: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [imgs, setImgs] = useState<Img[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);
  const seen = useRef(new Set<string>());

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const blankRow = (): Row => ({
    key: newKey(),
    include: true,
    date: today,
    amount: "",
    content: "",
    recipient: "",
    category: "KHAC",
    countInCost: true,
    fromOcr: false,
  });

  const readOne = async (img: Img) => {
    const r = await fetch("/api/admin/expenses/ocr", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ photo: img.data }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r || !r.ok) {
      setImgs((xs) => xs.map((x) => (x.id === img.id ? { ...x, state: "error", error: j.error || "Không đọc được ảnh" } : x)));
      return;
    }
    const txs = (j.transactions ?? []) as Tx[];
    const fresh = txs.filter((t) => {
      const k = txKey(t); // nhiều ảnh sao kê chụp chồng nhau → bỏ giao dịch lặp
      if (seen.current.has(k)) return false;
      seen.current.add(k);
      return true;
    });
    setRows((rs) => [
      ...rs,
      ...fresh.map((t) => ({
        key: newKey(),
        include: !t.dupHint,
        date: t.date ?? today,
        amount: String(t.amount),
        content: t.transferNote || t.purpose || t.recipient || "",
        recipient: t.recipient ?? "",
        category: t.category ?? "KHAC",
        countInCost: defaultCountInCost(t.category ?? "KHAC"),
        salaryHint: t.salaryHint,
        dupHint: t.dupHint ?? (t.date ? undefined : "Không đọc được ngày – kiểm tra lại"),
        fromOcr: true,
        img: img.id,
      })),
    ]);
    setImgs((xs) => xs.map((x) => (x.id === img.id ? { ...x, state: "done", count: fresh.length } : x)));
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    const added: Img[] = [];
    for (const f of Array.from(files).slice(0, 10 - imgs.length)) {
      try {
        added.push({ id: ++seq, data: await fileToJpeg(f), state: ocrEnabled ? "reading" : "done", count: ocrEnabled ? undefined : 0 });
      } catch (e) {
        setMsg({ tone: "red", text: (e as Error).message });
      }
    }
    setImgs((xs) => [...xs, ...added]);
    if (!ocrEnabled) {
      if (!rows.length) setRows([blankRow()]);
      return;
    }
    for (const img of added) await readOne(img); // đọc lần lượt (mỗi ảnh 1 lượt gọi AI)
  };

  const removeImg = (id: number) => {
    setImgs((xs) => xs.filter((x) => x.id !== id));
    setRows((rs) => rs.filter((r) => r.img !== id));
  };

  const chosen = rows.filter((r) => r.include);
  const amounts = new Map(rows.map((r) => [r.key, evalMoneyExpr(r.amount)]));
  const counted = chosen.filter((r) => r.countInCost).reduce((s, r) => s + (amounts.get(r.key)?.value ?? 0), 0);
  const notCounted = chosen.filter((r) => !r.countInCost).reduce((s, r) => s + (amounts.get(r.key)?.value ?? 0), 0);
  const problems = chosen.filter((r) => {
    const a = amounts.get(r.key)!;
    return !a.ok || a.value <= 0 || !r.date;
  });
  const reading = imgs.some((i) => i.state === "reading");

  const save = async () => {
    setBusy(true);
    setMsg(null);
    // ảnh gửi kèm Telegram: request tối đa ~4MB → ảnh quá nặng thì chỉ gửi danh sách
    let photos = imgs.map((i) => i.data);
    const size = photos.reduce((s, p) => s + p.length, 0);
    const dropPhotos = size > 3_500_000;
    if (dropPhotos) photos = [];
    const r = await fetch("/api/admin/expenses/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        photos,
        rows: chosen.map((x) => ({
          date: x.date,
          amount: amounts.get(x.key)!.value,
          category: x.category,
          target: "SHARED", // chi phí admin nhập = chi phí chung của chuỗi
          content: x.content,
          recipient: x.recipient,
          countInCost: x.countInCost,
          fromOcr: x.fromOcr,
        })),
      }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Lỗi mạng" };
    setBusy(false);
    if (!r || !r.ok) return setMsg({ tone: "red", text: j.error || "Lưu thất bại" });
    setMsg({ tone: j.telegram === "SENT" ? "green" : "orange", text: `${j.message}${dropPhotos ? " (Ảnh quá nặng nên chỉ gửi danh sách, không kèm ảnh.)" : ""}` });
    setImgs([]);
    setRows([]);
    seen.current.clear();
    router.refresh();
  };

  return (
    <div className="space-y-3">
      {msg && (
        <Alert tone={msg.tone}>
          {msg.tone === "green" ? <CheckCircle2 size={16} className="mr-1 inline" /> : <TriangleAlert size={16} className="mr-1 inline" />}
          {msg.text}
        </Alert>
      )}

      <Button type="button" variant="secondary" className="w-full py-3" disabled={busy || reading || imgs.length >= 10} onClick={() => fileRef.current?.click()}>
        <ImageUp size={18} /> Chọn ảnh sao kê / biên lai CK
      </Button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files).finally(() => (e.target.value = ""))} />
      <p className="text-xs text-ink/60">
        {ocrEnabled
          ? "Ảnh sao kê có nhiều giao dịch → AI tách từng lệnh chuyển khoản (chỉ lấy tiền ra). Biên lai CK / bill → 1 khoản. Chọn được nhiều ảnh, giao dịch trùng giữa các ảnh tự bỏ."
          : "Chưa bật AI đọc ảnh (GEMINI_API_KEY) – ảnh chỉ gửi kèm vào nhóm, các khoản nhập tay."}
      </p>

      {imgs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {imgs.map((i) => (
            <div key={i.id} className="relative w-20">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={i.data} alt="Ảnh chứng từ" className="h-24 w-20 rounded-lg object-cover object-top ring-1 ring-ink/10" />
              <button type="button" onClick={() => removeImg(i.id)} className="absolute -top-1.5 -right-1.5 rounded-full bg-shade p-0.5 text-white" aria-label="Bỏ ảnh">
                <X size={12} />
              </button>
              <p className={`mt-0.5 text-center text-[10px] ${i.state === "error" ? "text-danger" : "text-ink/60"}`} title={i.error}>
                {i.state === "reading" ? <Loader2 size={12} className="inline animate-spin" /> : i.state === "error" ? "Lỗi đọc" : ocrEnabled ? `${i.count} giao dịch` : "Ảnh"}
              </p>
            </div>
          ))}
        </div>
      )}
      {imgs.filter((i) => i.state === "error").map((i) => <p key={i.id} className="text-xs text-danger">{i.error}</p>)}
      {reading && <p className="flex items-center gap-1.5 text-sm text-accent"><Loader2 size={16} className="animate-spin" /> AI đang đọc ảnh…</p>}


      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((r, i) => {
            const a = amounts.get(r.key)!;
            return (
              <li key={r.key} className={`rounded-xl p-2.5 ring-1 ${r.include ? "bg-card ring-line" : "bg-gray-50 opacity-60 ring-mute-line"}`}>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-ink/70">
                    <input type="checkbox" checked={r.include} onChange={(e) => patch(r.key, { include: e.target.checked })} className="h-4 w-4" />
                    Lưu #{i + 1}
                  </label>
                  {r.fromOcr && <Sparkles size={13} className="text-secondary" />}
                  <span className="flex-1" />
                  <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-ink/40 hover:text-danger" aria-label="Xoá dòng">
                    <X size={16} />
                  </button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <Input type="date" value={r.date} onChange={(e) => patch(r.key, { date: e.target.value })} aria-label="Ngày" />
                  <ExprMoneyInput value={r.amount} onChange={(v) => patch(r.key, { amount: v })} placeholder="Số tiền" aria-label="Số tiền" />
                  <Select
                    className="col-span-2"
                    value={r.category}
                    onChange={(e) => patch(r.key, { category: e.target.value, countInCost: defaultCountInCost(e.target.value) })}
                    aria-label="Mục"
                  >
                    {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </Select>
                  <Input className="col-span-2" value={r.content} maxLength={300} onChange={(e) => patch(r.key, { content: e.target.value })} placeholder="Nội dung chi tiết (nội dung CK)" aria-label="Nội dung" />
                </div>
                <label className={`mt-2 flex flex-wrap items-center gap-x-2 text-sm ${r.countInCost ? "text-good" : "text-ink/60"}`}>
                  <input type="checkbox" checked={r.countInCost} onChange={(e) => patch(r.key, { countInCost: e.target.checked })} className="h-4 w-4" />
                  Tính vào chi phí
                  {!r.countInCost && <span className="w-full pl-6 text-[11px]">(chỉ lưu chứng từ{r.category === "LUONG" ? " – lương đã có trong bảng lương" : ""})</span>}
                </label>
                {r.salaryHint && <p className="mt-1 text-[11px] text-warn">{r.salaryHint}</p>}
                {r.dupHint && <p className="mt-1 text-[11px] text-danger">⚠ {r.dupHint}{r.include ? "" : " – đã bỏ chọn"}</p>}
                {!a.ok && r.amount.trim() && <p className="mt-1 text-[11px] text-danger">Số tiền không hợp lệ</p>}
              </li>
            );
          })}
        </ul>
      )}

      <Button type="button" variant="outline" className="w-full" onClick={() => setRows((rs) => [...rs, blankRow()])} disabled={busy}>
        <Plus size={16} /> Thêm dòng nhập tay
      </Button>

      {rows.length > 0 && (
        <div className="rounded-xl bg-cream px-3 py-2 text-sm">
          <p>
            Chọn <b>{chosen.length}</b>/{rows.length} khoản · tính vào chi phí <b className="text-accent">{counted.toLocaleString("vi-VN")} đ</b>
          </p>
          {notCounted > 0 && <p className="text-xs text-ink/60">+ {notCounted.toLocaleString("vi-VN")} đ chỉ lưu chứng từ (không tính chi phí)</p>}
          {problems.length > 0 && <p className="text-xs text-danger">{problems.length} khoản thiếu ngày / số tiền / cơ sở.</p>}
          {chosen.some((r) => r.date > today) && <p className="text-xs text-danger">Có khoản ngày ở tương lai ({viDate(today)} là hôm nay).</p>}
        </div>
      )}

      <Button type="button" variant="secondary" className="w-full py-3 text-base" disabled={busy || reading || !chosen.length || problems.length > 0} onClick={save}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang lưu…" : `Lưu ${chosen.length || ""} khoản & gửi nhóm`}
      </Button>
    </div>
  );
}
