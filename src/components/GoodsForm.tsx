"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Minus, Plus, Sparkles, X } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { mergeLines, parseGoodsText, qtyVi, type GoodsItem, type GoodsLine } from "@/lib/goods";
import type { GoodsInput } from "@/lib/goods-server";

type Draft = { key: string; date: string; lines: GoodsLine[]; note: string; raw?: string; sender?: string; time?: string; source: "TEXT" | "PHOTO" | "MANUAL"; dup?: string; unknown?: string[] };
type SaveInput = { storeId: string; drafts: GoodsInput[]; telegram: boolean; id?: string };
type Result = { ok?: boolean; error?: string; message?: string };

let seq = 0;
const blank = (date: string): Draft => ({ key: `d${++seq}`, date, lines: [], note: "", source: "TEXT" });
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Ảnh chụp màn hình nhóm chat: thu nhỏ còn JPEG ≤ 1600px */
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
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const qtyText = (n: number) => String(n).replace(".", ",");
const qtyParse = (s: string) => {
  const v = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(v) && v >= 0 ? v : null;
};
/** ô số lượng: gõ được "1,5" (chỉ đổi số khi gõ hợp lệ) */
function QtyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [t, setT] = useState(qtyText(value));
  useEffect(() => {
    if (qtyParse(t) !== value) setT(qtyText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      value={t}
      inputMode="decimal"
      onChange={(e) => {
        setT(e.target.value);
        const v = qtyParse(e.target.value);
        if (v != null) onChange(v);
      }}
      onBlur={() => setT(qtyText(value))}
      className="w-14 rounded-lg border border-[#e9d9a8] px-1 py-1 text-center text-base"
    />
  );
}

/**
 * Ghi đồ đã nhận: gõ như nhắn nhóm ("nhận 5mn, 2nl, 3 bột na") hoặc chọn ảnh chụp nhóm chat (AI đọc)
 * → kiểm tra danh sách món → Lưu (+ báo nhóm Telegram cơ sở).
 */
export default function GoodsForm({
  mode,
  catalog,
  today,
  minDate,
  ocrEnabled,
  stores,
  storeId: storeId0 = "",
  storeName,
  initial,
  save,
}: {
  mode: "user" | "admin";
  catalog: GoodsItem[];
  today: string;
  minDate?: string;
  ocrEnabled: boolean;
  /** admin: chọn cơ sở */
  stores?: { id: string; name: string }[];
  storeId?: string;
  storeName?: string;
  /** admin sửa 1 lần nhận */
  initial?: { id: string; storeId: string; date: string; lines: GoodsLine[]; note: string };
  save: (input: SaveInput) => Promise<Result>;
}) {
  const router = useRouter();
  const [storeId, setStoreId] = useState(initial?.storeId ?? storeId0);
  const [drafts, setDrafts] = useState<Draft[]>(() => [initial ? { ...blank(initial.date), lines: initial.lines, note: initial.note, source: "MANUAL" } : blank(today)]);
  const [text, setText] = useState("");
  const [telegram, setTelegram] = useState(!initial);
  const [busy, setBusy] = useState<"" | "ai" | "save">("");
  const [msg, setMsg] = useState<{ tone: "red" | "green" | "yellow"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => parseGoodsText(text, catalog), [text, catalog]);
  const unitOf = useMemo(() => new Map(catalog.map((c) => [c.name, c.unit])), [catalog]);

  const patch = (key: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const setLines = (key: string, f: (l: GoodsLine[]) => GoodsLine[]) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, lines: f(d.lines) } : d)));
  const addToFirst = (lines: GoodsLine[], raw?: string) =>
    setDrafts((ds) => {
      const [d0, ...rest] = ds.length ? ds : [blank(today)];
      return [{ ...d0, lines: mergeLines([...d0.lines, ...lines]), raw: [d0.raw, raw].filter(Boolean).join("\n").slice(0, 500) || undefined }, ...rest];
    });

  /** chữ đang gõ → thêm vào danh sách (lần nhận đầu tiên) */
  const addText = () => {
    if (!preview.lines.length) return false;
    addToFirst(preview.lines, text.trim());
    setText("");
    return true;
  };

  async function askAi(body: { photos?: string[]; text?: string }) {
    setBusy("ai");
    setMsg(null);
    try {
      const r = await fetch("/api/goods/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, as: mode, storeId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) return setMsg({ tone: "red", text: j.error || "AI chưa đọc được – gõ tay giúp nhé" });
      const got = (j.drafts ?? []) as Omit<Draft, "key" | "note" | "source">[];
      if (body.text) {
        // chữ gõ → gộp vào danh sách đang nhập
        addToFirst(got.flatMap((g) => g.lines), body.text);
        setText("");
        const unk = got.flatMap((g) => g.unknown ?? []);
        if (unk.length) setMsg({ tone: "yellow", text: `Không có trong danh mục: ${unk.join(", ")} – báo admin thêm vào danh mục nếu cần` });
        return;
      }
      // ảnh nhóm chat → mỗi tin báo nhận 1 lần; đã có trong nhóm rồi → mặc định không báo lại
      const fresh = got.map((g) => ({ ...blank(g.date), ...g, note: "", source: "PHOTO" as const }));
      setDrafts((ds) => [...ds.filter((d) => d.lines.length), ...fresh]);
      setTelegram(false);
      setMsg({ tone: "green", text: `AI đọc được ${fresh.length} tin báo nhận – kiểm tra lại số rồi bấm Lưu` });
    } catch {
      setMsg({ tone: "red", text: "Mất kết nối – thử lại" });
    } finally {
      setBusy("");
    }
  }

  async function onPhotos(files: FileList | null) {
    const list = [...(files ?? [])].slice(0, 4);
    if (fileRef.current) fileRef.current.value = "";
    if (!list.length) return;
    try {
      const photos = await Promise.all(list.map((f) => fileToJpeg(f)));
      await askAi({ photos });
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    }
  }

  async function onSave() {
    // chữ đang gõ mà chưa bấm Thêm → tự thêm
    let ds = drafts;
    if (preview.lines.length) {
      const [d0, ...rest] = ds;
      ds = [{ ...d0, lines: mergeLines([...d0.lines, ...preview.lines]), raw: [d0.raw, text.trim()].filter(Boolean).join("\n") }, ...rest];
      setDrafts(ds);
      setText("");
    }
    const used = ds.filter((d) => d.lines.length);
    if (!used.length) return setMsg({ tone: "red", text: "Chưa có món nào – gõ “nhận 5mn, 2nl…” hoặc thêm món" });
    if (mode === "admin" && !storeId) return setMsg({ tone: "red", text: "Chọn cơ sở" });
    setBusy("save");
    setMsg(null);
    const r = await save({
      storeId,
      telegram,
      id: initial?.id,
      drafts: used.map((d) => ({ date: d.date, lines: d.lines, note: d.note, raw: d.raw, sender: d.sender, source: d.source })),
    }).catch(() => ({ error: "Mất kết nối – thử lại" }) as Result);
    setBusy("");
    if (r.error) return setMsg({ tone: "red", text: r.error });
    setMsg({ tone: "green", text: r.message || "Đã lưu ✔" });
    if (!initial) {
      setDrafts([blank(today)]);
      setTelegram(true);
    }
    router.refresh();
  }

  const total = drafts.reduce((s, d) => s + d.lines.length, 0);
  return (
    <div className="space-y-3">
      {mode === "admin" && stores ? (
        <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-full rounded-xl border border-[#e9d9a8] bg-white px-3 py-2 text-sm">
          <option value="">— Chọn cơ sở —</option>
          {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      ) : (
        storeName && <p className="text-sm">Cơ sở: <b>{storeName}</b></p>
      )}

      {/* ô gõ nhanh – giống nhắn nhóm */}
      <div className="rounded-2xl bg-cream p-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Gõ như nhắn nhóm: nhận 5mn, 2nl, 3 bột na"
          className="w-full resize-none rounded-xl border border-[#e9d9a8] bg-white px-3 py-2 text-base"
        />
        {text.trim() && (
          <div className="mt-1.5 space-y-1 text-sm">
            {preview.lines.length > 0 && (
              <p className="text-secondary-dark">
                Hiểu là: <b>{preview.lines.map((l) => `${l.name} ${qtyVi(l.qty)}${l.unit ? ` ${l.unit}` : ""}`).join(" · ")}</b>
              </p>
            )}
            {preview.unknown.length > 0 && (
              <p className="text-warn">
                Chưa hiểu: “{preview.unknown.join("”, “")}”
                {ocrEnabled && (
                  <button type="button" disabled={!!busy} onClick={() => askAi({ text })} className="ml-1 inline-flex items-center gap-1 font-semibold text-accent underline">
                    <Sparkles size={13} /> Nhờ AI đọc
                  </button>
                )}
              </p>
            )}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={!preview.lines.length || !!busy} onClick={addText} className="flex-1">
            <Plus size={16} /> Thêm vào danh sách
          </Button>
          {ocrEnabled && (
            <>
              <Button type="button" variant="outline" disabled={!!busy} onClick={() => fileRef.current?.click()} className="flex-1">
                {busy === "ai" ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />} {busy === "ai" ? "AI đang đọc…" : "Ảnh nhóm chat"}
              </Button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onPhotos(e.target.files)} />
            </>
          )}
        </div>
      </div>

      {drafts.map((d, di) => (
        <div key={d.key} className={`rounded-2xl p-3 ring-1 ${d.dup ? "bg-[#fff4e5] ring-warn/40" : "bg-white ring-[#f1e6c8]"}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-bold text-accent">{drafts.length > 1 ? `Lần ${di + 1}` : "Đồ đã nhận"}</span>
            <input
              type="date"
              value={d.date}
              min={minDate}
              max={today}
              onChange={(e) => patch(d.key, { date: e.target.value })}
              className="rounded-lg border border-[#e9d9a8] px-2 py-0.5 text-sm"
            />
            {d.date !== today && <span className="text-xs text-ink/60">({dm(d.date)})</span>}
            {d.sender && <span className="text-xs text-ink/60">· {d.sender}{d.time ? ` ${d.time}` : ""}</span>}
            {drafts.length > 1 && (
              <button type="button" onClick={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))} className="ml-auto text-xs text-danger underline">
                Bỏ lần này
              </button>
            )}
          </div>
          {d.dup && <p className="mb-2 text-xs font-semibold text-warn">⚠ {d.dup}</p>}
          {d.raw && d.source === "PHOTO" && <p className="mb-2 rounded-lg bg-cream px-2 py-1 text-xs italic text-ink/70">“{d.raw}”</p>}
          {!!d.unknown?.length && <p className="mb-2 text-xs text-warn">Không có trong danh mục: {d.unknown.join(", ")}</p>}

          {d.lines.length === 0 ? (
            <p className="py-2 text-center text-sm text-ink/50">Chưa có món – gõ ở ô trên hoặc chọn bên dưới</p>
          ) : (
            <ul className="divide-y divide-[#f1e6c8]">
              {d.lines.map((l, li) => (
                <li key={`${l.name}|${l.unit}`} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                  <button type="button" aria-label="Bớt" onClick={() => setLines(d.key, (ls) => ls.map((x, k) => (k === li ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} className="grid h-8 w-8 place-items-center rounded-full bg-cream">
                    <Minus size={15} />
                  </button>
                  <QtyInput value={l.qty} onChange={(v) => setLines(d.key, (ls) => ls.map((x, k) => (k === li ? { ...x, qty: v } : x)))} />
                  <button type="button" aria-label="Thêm" onClick={() => setLines(d.key, (ls) => ls.map((x, k) => (k === li ? { ...x, qty: x.qty + 1 } : x)))} className="grid h-8 w-8 place-items-center rounded-full bg-cream">
                    <Plus size={15} />
                  </button>
                  <input
                    value={l.unit}
                    placeholder="đv"
                    onChange={(e) => setLines(d.key, (ls) => ls.map((x, k) => (k === li ? { ...x, unit: e.target.value.slice(0, 20) } : x)))}
                    className="w-14 rounded-lg border border-transparent px-1 py-1 text-xs text-ink/70 focus:border-[#e9d9a8]"
                  />
                  <button type="button" aria-label="Xoá" onClick={() => setLines(d.key, (ls) => ls.filter((_, k) => k !== li))} className="text-ink/40 hover:text-danger">
                    <X size={17} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <select
            value=""
            onChange={(e) => {
              const name = e.target.value;
              if (name) setLines(d.key, (ls) => mergeLines([...ls, { name, qty: 1, unit: unitOf.get(name) ?? "" }]));
            }}
            className="mt-2 w-full rounded-xl border border-dashed border-[#e9d9a8] bg-white px-3 py-2 text-sm text-ink/70"
          >
            <option value="">+ Thêm món…</option>
            {catalog.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
          <input
            value={d.note}
            onChange={(e) => patch(d.key, { note: e.target.value })}
            placeholder="Ghi chú (tuỳ chọn) – VD thiếu 1 hộp, hàng hỏng…"
            className="mt-2 w-full rounded-xl border border-[#e9d9a8] px-3 py-2 text-sm"
          />
        </div>
      ))}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} className="h-4 w-4" />
        Báo vào nhóm Telegram của cơ sở
      </label>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <Button type="button" onClick={onSave} disabled={!!busy || (!total && !preview.lines.length)} className="w-full py-3 text-base">
        {busy === "save" ? <Loader2 size={18} className="animate-spin" /> : "📦"} {initial ? "Lưu sửa" : "Lưu nhận hàng"}
      </Button>
    </div>
  );
}
