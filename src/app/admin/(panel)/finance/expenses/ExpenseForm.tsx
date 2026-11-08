"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send, TriangleAlert } from "lucide-react";
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
  transferNote: string;
  kind: "BILL" | "TRANSFER";
  note: string;
  scope: "STORE" | "SHARED";
  storeId: string;
  allocation: string;
  shares: Record<string, string>;
  paidFrom: "OWNER" | "CASHBOX";
};

const pill = (on: boolean) =>
  `rounded-xl px-3 py-2 text-sm ring-1 transition ${on ? "bg-secondary font-bold text-white ring-secondary-dark" : "bg-gray-100 text-gray-500 ring-gray-200 hover:bg-gray-200"}`;

export default function ExpenseForm({
  stores,
  today,
  initial,
  onDone,
}: {
  stores: StoreOpt[];
  today: string;
  initial: ExpenseInitial;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<ExpenseInitial>(initial);
  const set = <K extends keyof ExpenseInitial>(k: K, v: ExpenseInitial[K]) => setF((o) => ({ ...o, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);
  const [dup, setDup] = useState<string | null>(null);
  const editing = !!f.id;

  const amt = evalMoneyExpr(f.amount);
  const sharesSum = Object.values(f.shares).reduce((s, v) => s + (Number(v.replace(",", ".")) || 0), 0);

  // cảnh báo sau khi đọc bill: thiếu số tiền / ngày, ngày lạ
  const warnings: { text: string; fixed?: boolean }[] = [];
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
        date: f.date,
        amount: amt.value,
        category: f.category,
        vendor: f.vendor,
        items: f.items,
        transferNote: f.transferNote,
        kind: f.kind,
        note: f.note,
        scope: f.scope,
        storeId: f.scope === "STORE" ? f.storeId : undefined,
        allocation: f.allocation,
        customShares: stores.map((s) => ({ storeId: s.id, pct: Number((f.shares[s.id] ?? "").replace(",", ".")) || 0 })),
        paidFrom: f.paidFrom,
        allowDuplicate,
      }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : { error: "Lỗi mạng" };
    setBusy(false);
    if (r?.status === 409 && j.code === "DUPLICATE") return setDup(j.error);
    if (!r || !r.ok) return setMsg({ tone: "red", text: j.error || "Lưu thất bại" });
    setMsg({ tone: j.telegram === "SENT" ? "green" : "orange", text: j.message });
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

      {f.category === "LUONG" && (
        <div className="rounded-xl bg-[#fff4e5] px-3 py-2 text-xs text-warn">
          <p>
            Danh mục <b>Lương NV</b>: chỉ lưu chứng từ và báo nhóm, <b>không cộng vào chi phí</b> vì lương đã tính từ giờ công / bảng lương. Nếu không phải lương → đổi danh mục.
          </p>
        </div>
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
        <div className="col-span-2">
          <Field label="Chi cho việc gì">
            <Input value={f.items} maxLength={300} onChange={(e) => set("items", e.target.value)} placeholder="VD: Nhập sữa đặc x5, tiền điện T10…" />
          </Field>
        </div>
        <Field label={f.kind === "TRANSFER" ? "Người nhận" : "Nơi bán / người nhận"}>
          <Input value={f.vendor} maxLength={120} onChange={(e) => set("vendor", e.target.value)} placeholder="VD: Bách hoá XANH" />
        </Field>
        <Field label="Nội dung CK">
          <Input value={f.transferNote} maxLength={200} onChange={(e) => set("transferNote", e.target.value)} placeholder="Nếu chuyển khoản" />
        </Field>
        <div className="col-span-2">
          <Field label="Ghi chú">
            <Textarea rows={2} value={f.note} maxLength={500} onChange={(e) => set("note", e.target.value)} />
          </Field>
        </div>
      </div>

      <Button type="button" variant="secondary" className="w-full py-3 text-base" disabled={busy || !ready} onClick={() => save()}>
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang lưu…" : editing ? "Lưu thay đổi & báo nhóm" : "Lưu & gửi nhóm"}
      </Button>
      {!ready && <p className="text-center text-xs text-ink/60">Nhập ngày, số tiền{f.scope === "STORE" ? ", chọn cơ sở" : ""}.</p>}

      <ConfirmDialog open={!!dup} title="Có thể bị trùng bill" confirmLabel="Vẫn lưu" busy={busy} onCancel={() => setDup(null)} onConfirm={() => { setDup(null); save(true); }}>
        <p>{dup}</p>
        <p>Bạn vẫn muốn lưu khoản chi này?</p>
      </ConfirmDialog>
    </div>
  );
}
