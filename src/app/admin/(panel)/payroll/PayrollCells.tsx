"use client";
import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import Modal from "@/components/Modal";
import { evalCalc } from "@/lib/calc-expr";
import { suggestUnpaidDays, unpaidLeaveAmount } from "@/lib/salary";
import { addPayrollExtras, removePayrollExtra } from "../../actions/ops";

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;

/** 1 khoản phụ cấp / tạm ứng đã lưu; index = vị trí trong extrasNotes, -1 = phần nhập tay không ghi chú */
export type ExtraEntry = { index: number; amount: number; note: string; meta?: string };
type Row = { text: string; note: string };
/** Full-time: dữ liệu tính tiền nghỉ không lương ở popup Tạm ứng */
export type LeaveInfo = { monthlySalary: number; paidLeaveDays: number; daysInMonth: number; workDays: number };
const days = (n: number) => String(n).replace(".", ",");

/**
 * Ô Phụ cấp / Tạm ứng (giống ô Thưởng / Phạt): 0 đ → nút "+"; có tiền → bấm số tiền xem chi tiết.
 * Popup: danh sách từng khoản (xoá được) + các dòng nhập "số tiền + nội dung" (Thêm dòng) → Lưu → đóng popup.
 * Số tiền gõ được "155k", "1tr2", "31 × 5k".
 */
export function ExtrasCell({
  itemId,
  field,
  total,
  entries,
  name,
  locked,
  leave,
}: {
  itemId: string;
  field: "allowance" | "advance";
  total: number;
  entries: ExtraEntry[];
  name: string;
  locked: boolean;
  leave?: LeaveInfo;
}) {
  const plus = field === "allowance";
  const label = plus ? "Phụ cấp" : "Tạm ứng";
  const tone = plus ? "text-secondary-dark" : "text-danger";
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [unpaid, setUnpaid] = useState("");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const show = () => {
    setRows(total || locked || leave ? [] : [{ text: "", note: "" }]);
    setUnpaid(leave ? days(suggestUnpaidDays(leave.daysInMonth, leave.workDays, leave.paidLeaveDays)) : "");
    setError("");
    setOpen(true);
  };
  const parsed = rows.map((r) => ({ amount: r.text.trim() ? evalCalc(r.text) : null, note: r.note.trim() }));
  const rowsOk = parsed.length > 0 && parsed.every((r) => r.amount != null && r.amount > 0);
  const save = () =>
    start(async () => {
      const r = await addPayrollExtras(itemId, field, parsed.map((p) => ({ amount: p.amount ?? 0, note: p.note })));
      if (r?.error) setError(r.error);
      else setOpen(false);
    });
  // nghỉ không lương = lương / (số ngày trong tháng − ngày nghỉ có lương) × số ngày nghỉ không lương
  const unpaidDays = Number(unpaid.replace(",", "."));
  const leaveAmount = leave ? unpaidLeaveAmount(leave.monthlySalary, leave.daysInMonth, leave.paidLeaveDays, unpaidDays) : null;
  const addLeaveRow = () => {
    if (!leave || leaveAmount == null) return;
    const note = `Nghỉ không lương ${days(unpaidDays)} ngày = ${vnd(leave.monthlySalary)} / (${leave.daysInMonth} − ${days(leave.paidLeaveDays)}) × ${days(unpaidDays)}`;
    setRows([...rows.filter((r) => r.text.trim()), { text: String(leaveAmount), note }]);
  };
  const remove = (e: ExtraEntry) => {
    if (!confirm(`Xoá khoản ${label.toLowerCase()} ${vnd(e.amount)}${e.note ? ` – ${e.note}` : ""}?`)) return;
    start(async () => {
      const r = await removePayrollExtra(itemId, field, e.index);
      setError(r?.error ?? "");
    });
  };

  if (!total && locked) return <span className="text-ink/40">0 ₫</span>;
  return (
    <>
      {total ? (
        <button type="button" onClick={show} className={`cursor-pointer font-semibold whitespace-nowrap underline decoration-dotted underline-offset-2 ${tone}`}>
          {plus ? "+" : "−"}
          {vnd(total)}
        </button>
      ) : (
        <button
          type="button"
          onClick={show}
          aria-label={`Thêm ${label.toLowerCase()} cho ${name}`}
          title={`Thêm ${label.toLowerCase()}`}
          className={`flex h-8 w-8 items-center justify-center rounded-full ${plus ? "bg-[#e3f4e8] text-secondary-dark" : "bg-[#fde4e4] text-danger"}`}
        >
          <Plus size={16} />
        </button>
      )}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label={`${label} · ${name}`}>
            <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 text-sm shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <b className={tone}>
                  {plus ? "+ " : "− "}
                  {label} · {name}
                </b>
                <button type="button" onClick={() => setOpen(false)} aria-label="Đóng" className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cream">
                  <X size={18} />
                </button>
              </div>

              {!!entries.length && (
                <ul className="mb-3 space-y-1.5">
                  {entries.map((e) => (
                    <li key={e.index} className="flex items-start gap-2 rounded-xl bg-cream px-2.5 py-1.5">
                      <span className="min-w-0 flex-1">
                        <b className={tone}>{vnd(e.amount)}</b> · {e.note || <i className="text-ink/50">không ghi chú</i>}
                        {e.meta && <span className="block text-[11px] text-ink/50">{e.meta}</span>}
                      </span>
                      {!locked && (
                        <button type="button" disabled={pending} onClick={() => remove(e)} aria-label="Xoá khoản này" className="rounded p-1 text-ink/40 hover:bg-white hover:text-danger">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-dashed border-[#f1e6c8] px-2.5 pt-1.5 font-bold">
                    <span>Tổng</span>
                    <span className={tone}>{vnd(total)}</span>
                  </li>
                </ul>
              )}
              {locked && <p className="text-xs text-ink/60">🔒 Đã trả lương – mở khoá dòng lương để sửa.</p>}

              {!locked && leave && (
                <div className="mb-3 rounded-xl border border-[#e9d9a8] bg-cream/60 p-2.5">
                  <p className="mb-1.5 font-semibold text-accent">Nghỉ không lương (Full-time)</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-ink/70">Lương cứng</dt><dd className="text-right">{vnd(leave.monthlySalary)}</dd>
                    <dt className="text-ink/70">Số ngày trong tháng</dt><dd className="text-right">{leave.daysInMonth}</dd>
                    <dt className="text-ink/70">Ngày nghỉ có lương</dt><dd className="text-right font-semibold">{days(leave.paidLeaveDays)}</dd>
                    <dt className="text-ink/70">Ngày có chấm công</dt><dd className="text-right">{leave.workDays}</dd>
                  </dl>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="block text-[11px] text-ink/70">Ngày nghỉ không lương</span>
                      <input
                        value={unpaid}
                        onChange={(e) => setUnpaid(e.target.value)}
                        inputMode="decimal"
                        aria-label="Số ngày nghỉ không lương"
                        className="block w-24 rounded-xl border border-[#e9d9a8] bg-white px-2.5 py-1.5 text-right tabular-nums outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </label>
                    <span className="flex-1 pb-1.5 text-right text-xs">
                      {leaveAmount != null ? (
                        <>
                          {vnd(leave.monthlySalary)} / ({leave.daysInMonth} − {days(leave.paidLeaveDays)}) × {days(unpaidDays)} = <b className="text-danger">{vnd(leaveAmount)}</b>
                        </>
                      ) : (
                        <span className="text-ink/50">{leave.daysInMonth - leave.paidLeaveDays > 0 ? "Nhập số ngày > 0" : "Ngày nghỉ có lương ≥ số ngày trong tháng"}</span>
                      )}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink/50">Gợi ý = số ngày trong tháng − ngày có chấm công − ngày nghỉ có lương; sửa lại nếu cần.</p>
                  <button
                    type="button"
                    disabled={leaveAmount == null}
                    onClick={addLeaveRow}
                    className="mt-2 flex items-center gap-1 rounded-xl bg-white px-2.5 py-1.5 text-xs font-semibold text-danger ring-1 ring-[#f3c4c4] disabled:opacity-50"
                  >
                    <Plus size={14} /> Thêm vào tạm ứng
                  </button>
                </div>
              )}

              {!locked && (
                <div className="space-y-2">
                  {rows.map((r, k) => {
                    const p = parsed[k];
                    const bad = !!r.text.trim() && (p.amount == null || p.amount <= 0);
                    return (
                      <div key={k} className="flex items-start gap-1.5">
                        <div className="w-32 shrink-0">
                          <input
                            autoFocus={k === rows.length - 1}
                            value={r.text}
                            onChange={(e) => setRows(rows.map((x, z) => (z === k ? { ...x, text: e.target.value } : x)))}
                            placeholder="Số tiền"
                            aria-label="Số tiền"
                            className={`block w-full rounded-xl border px-2.5 py-2 text-right tabular-nums outline-none focus:ring-2 focus:ring-primary/40 ${bad ? "border-danger text-danger" : "border-[#e9d9a8]"}`}
                          />
                          {p.amount != null && p.amount > 0 && /[^\d.,\s]/.test(r.text) && <span className="block pr-1 text-right text-[11px] text-ink/60">= {vnd(p.amount)}</span>}
                        </div>
                        <input
                          value={r.note}
                          onChange={(e) => setRows(rows.map((x, z) => (z === k ? { ...x, note: e.target.value } : x)))}
                          placeholder={plus ? "Nội dung (VD hỗ trợ ship 31 đơn)" : "Nội dung (VD ứng giữa tháng)"}
                          aria-label="Nội dung"
                          maxLength={200}
                          className="block min-w-0 flex-1 rounded-xl border border-[#e9d9a8] px-2.5 py-2 outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <button type="button" onClick={() => setRows(rows.filter((_, z) => z !== k))} aria-label="Bỏ dòng" className="mt-1.5 rounded p-1 text-ink/40 hover:text-danger">
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => setRows([...rows, { text: "", note: "" }])} className="flex items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-accent hover:bg-primary-light">
                    <Plus size={14} /> Thêm dòng
                  </button>
                  {error && <p className="text-xs text-danger">{error}</p>}
                  {!!rows.length && (
                    <button
                      type="button"
                      disabled={!rowsOk || pending}
                      onClick={save}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 font-semibold disabled:opacity-50"
                    >
                      {pending && <Loader2 size={16} className="animate-spin" />} Lưu {parsed.length > 1 && rowsOk ? `(${vnd(parsed.reduce((s, p) => s + (p.amount ?? 0), 0))})` : ""}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/** Số tài khoản + nút copy (chỉ copy số TK, không kèm tên ngân hàng). */
export function CopyAccount({ account }: { account: string }) {
  const [done, setDone] = useState(false);
  if (!account) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(account.replace(/\s+/g, ""));
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      /* trình duyệt chặn clipboard (http / quyền) – bỏ qua */
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      {account}
      <button type="button" onClick={copy} aria-label="Copy số tài khoản" title="Copy số tài khoản" className="rounded p-1 text-ink/60 hover:bg-primary-light hover:text-accent">
        {done ? <Check size={14} className="text-secondary-dark" /> : <Copy size={14} />}
      </button>
    </span>
  );
}

/** Số tiền thưởng / phạt: bấm (điện thoại không hover được) → popup chi tiết từng khoản. */
export function BpAmount({ amount, tip, title, className }: { amount: string; tip: string; title: string; className: string }) {
  if (!tip) return <span>{amount}</span>;
  return (
    <Modal label={amount} title={title} className={`cursor-pointer underline decoration-dotted underline-offset-2 ${className}`}>
      <ul className="space-y-1 text-sm">
        {tip.split("\n").map((l, i) => (
          <li key={i}>{l.replace(/^- /, "• ")}</li>
        ))}
      </ul>
    </Modal>
  );
}
