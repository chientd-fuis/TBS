"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Badge, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { recalcHours, type RecalcActionResult } from "../../actions/hours-recalc";

/* Bảng chấm công → Tính lại giờ công (dưới bảng Tổng hợp tháng): tích từng người / tất cả, Tính lại / Huỷ, xem trước ca được cộng. */

export type RecalcShift = {
  id: string;
  date: string; // dd/mm
  time: string; // 17:02–21:57
  worked: string; // 4h55
  rounded: number;
  shortMin: number;
  /** đang được cộng (đã ghi) */
  applied: boolean;
  /** nằm trong kế hoạch tính lại hiện tại */
  picked: boolean;
  gapBefore?: number;
  gapAfter?: number;
};
export type RecalcRowData = {
  userId: string;
  name: string;
  inactive: boolean;
  actual: number;
  base: number;
  final: number;
  auto: number;
  autoCount: number;
  matches: boolean;
  needed: boolean;
  enough: boolean;
  planAdded: number;
  planPicks: number;
  planAfter: number;
  planGapAfter: number;
  gapBase: number;
  cancelled: boolean;
  at?: string; // "19/11 22:00 · Tự động"
  shifts: RecalcShift[];
};

const hv = (n: number) => new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
/** 2.333 → "2h20" · −0.33 → "−0h20" */
export const hmVi = (h: number, sign = false) => {
  const neg = h < -1e-9;
  const t = Math.round(Math.abs(h) * 60);
  return `${neg ? "−" : sign && t > 0 ? "+" : ""}${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}`;
};

type Status = { tone: "green" | "orange" | "gray" | "red"; text: string; act: boolean; canCancel: boolean; need: boolean };
function statusOf(r: RecalcRowData, threshold: number, locked: boolean): Status {
  const applied = r.auto > 0;
  if (locked) return { tone: "gray", text: applied ? "Đã tính · tháng đã trả lương" : "Tháng đã trả lương", act: false, canCancel: false, need: false };
  if (r.cancelled) return { tone: "gray", text: "Đã huỷ – tự động bỏ qua", act: r.needed, canCancel: false, need: false };
  if (applied && r.matches)
    return r.enough
      ? { tone: "green", text: `Đã tính${r.at ? ` · ${r.at}` : ""}`, act: false, canCancel: true, need: false }
      : { tone: "orange", text: `Chỉ có ${r.autoCount} ca đủ điều kiện`, act: false, canCancel: true, need: false };
  if (r.needed || (applied && !r.matches)) return { tone: "orange", text: "Cần tính lại", act: true, canCancel: applied, need: true };
  return { tone: "gray", text: r.gapBase <= 0 ? "Không cần (giờ công đã ≥ thực tế)" : `Không cần (chênh ≤ ${hv(threshold)}h)`, act: false, canCancel: false, need: false };
}

export default function RecalcPanel({
  rows,
  storeId,
  month,
  locked,
  canEdit,
  threshold,
  maxShort,
  modeLabel,
  settingsHref,
}: {
  rows: RecalcRowData[];
  storeId: string;
  month: string;
  locked: boolean;
  canEdit: boolean;
  threshold: number;
  maxShort: number;
  modeLabel: string;
  settingsHref?: string;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<RecalcActionResult | null>(null);
  const [ask, setAsk] = useState<{ op: "apply" | "cancel"; ids: string[]; label: string } | null>(null);

  const list = useMemo(() => {
    const withStatus = rows.map((r) => ({ r, st: statusOf(r, threshold, locked) }));
    const rank = (x: (typeof withStatus)[number]) => (x.st.need ? 0 : x.r.auto > 0 ? 1 : x.r.cancelled ? 2 : 3);
    return withStatus.sort((a, b) => rank(a) - rank(b) || b.r.gapBase - a.r.gapBase);
  }, [rows, threshold, locked]);
  const selectable = list.filter((x) => canEdit && (x.st.act || x.st.canCancel || x.r.cancelled)).map((x) => x.r.userId);
  const needIds = list.filter((x) => x.st.need).map((x) => x.r.userId);
  const chosen = [...sel].filter((id) => selectable.includes(id));
  const chosenAdd = list.filter((x) => chosen.includes(x.r.userId)).reduce((s, x) => s + (x.r.auto > 0 && x.r.matches ? 0 : x.r.planAdded), 0);

  const run = (op: "apply" | "cancel", ids: string[]) =>
    start(async () => {
      setRes(null);
      const r = await recalcHours({ storeId, month, userIds: ids, op });
      setRes(r);
      if (r.ok) {
        setSel(new Set());
        router.refresh();
      }
    });

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = selectable.length > 0 && selectable.every((id) => sel.has(id));

  if (!rows.length) return <p className="text-sm text-ink/60">Chưa có lượt chấm công đã check-out trong tháng.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-ink/70">
          Giờ thực tế cao hơn giờ chấm công <b>quá {hv(threshold)}h</b> → app tìm các ca bị làm tròn xuống chỉ <b>thiếu ≤ {maxShort} phút</b> tới mốc kế tiếp, ưu tiên
          ca thiếu ít nhất, mỗi ca <b>+0,5h</b> (VD 4,5 → 5). Dừng khi chênh còn ≤ {hv(threshold)}h, không bao giờ vượt giờ thực tế. Giờ vào / ra gốc giữ nguyên.
        </p>
        <span className="flex items-center gap-2 text-xs">
          <Badge tone={modeLabel.startsWith("Tắt") ? "gray" : "green"}>Tự động: {modeLabel}</Badge>
          {settingsHref && <Link className="text-accent underline" href={settingsHref}>Cài đặt</Link>}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="tbs">
          <thead>
            <tr>
              <th className="w-8 text-center">
                <input
                  type="checkbox"
                  aria-label="Chọn tất cả"
                  className="h-4 w-4 accent-secondary"
                  disabled={!selectable.length || pending}
                  checked={allOn}
                  onChange={(e) => setSel(e.target.checked ? new Set(selectable) : new Set())}
                />
              </th>
              <th>Nhân viên</th>
              <th className="text-right">Giờ thực tế</th>
              <th className="text-right">Giờ chấm công</th>
              <th className="text-right">Chênh</th>
              <th className="text-right">Dự kiến cộng</th>
              <th className="text-right">Sau tính lại</th>
              <th>Trạng thái</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ r, st }) => {
              const can = selectable.includes(r.userId);
              const showPlan = r.needed || r.auto > 0;
              return (
                <Fragment key={r.userId}>
                  <tr className={st.need ? "row-late" : ""}>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${r.name}`}
                        className="h-4 w-4 accent-secondary"
                        disabled={!can || pending}
                        checked={can && sel.has(r.userId)}
                        onChange={() => toggle(r.userId)}
                      />
                    </td>
                    <td className="font-semibold">
                      {r.name}
                      {r.inactive && <span className="text-xs font-normal text-ink/50"> (nghỉ)</span>}
                    </td>
                    <td className="text-right">{hmVi(r.actual)}</td>
                    <td className="text-right">{hv(r.base)}</td>
                    <td className={`text-right ${r.gapBase > threshold + 1e-6 ? "font-semibold text-warn" : ""}`}>{hmVi(r.gapBase, true)}</td>
                    <td className="text-right">{showPlan && r.planPicks ? `+${hv(r.planAdded)}h · ${r.planPicks} ca` : "—"}</td>
                    <td className="text-right whitespace-nowrap">
                      {showPlan && r.planPicks ? (
                        <>
                          <b className="text-[#c62828]">{hv(r.planAfter)}</b>{" "}
                          <span className={r.enough ? "text-ink/60" : "text-warn"}>(chênh {hmVi(r.planGapAfter, true)})</span>
                        </>
                      ) : (
                        hv(r.final)
                      )}
                    </td>
                    <td>
                      <Badge tone={st.tone}>{st.text}</Badge>
                    </td>
                    <td className="space-x-2 text-xs whitespace-nowrap">
                      {r.shifts.length > 0 && (
                        <button type="button" className="text-accent underline" onClick={() => setOpen(open === r.userId ? null : r.userId)} aria-expanded={open === r.userId}>
                          {open === r.userId ? "Ẩn" : "Xem ca"}
                        </button>
                      )}
                      {canEdit && !locked && st.act && (
                        <button type="button" className="font-semibold text-good underline" disabled={pending} onClick={() => run("apply", [r.userId])}>
                          Tính lại
                        </button>
                      )}
                      {canEdit && st.canCancel && (
                        <button
                          type="button"
                          className="text-danger underline"
                          disabled={pending}
                          onClick={() => setAsk({ op: "cancel", ids: [r.userId], label: `Huỷ tính lại cho ${r.name}? Giờ công về ${hv(r.base)} và tự động sẽ bỏ qua người này trong tháng.` })}
                        >
                          Huỷ
                        </button>
                      )}
                    </td>
                  </tr>
                  {open === r.userId && (
                    <tr>
                      <td></td>
                      <td colSpan={8} className="bg-cream">
                        <ShiftDetail r={r} maxShort={maxShort} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {res?.error && <Alert tone="red">{res.error}</Alert>}
      {res?.ok && (
        <Alert tone="green">
          Đã xong {res.done} nhân viên.
          {res.locked ? ` Bỏ qua ${res.locked} người tháng đã trả lương.` : ""}
          {res.short?.length ? ` Không đủ ca thiếu ít phút: ${res.short.join(", ")} – xem tay.` : ""}
        </Alert>
      )}

      {canEdit && !locked && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink/70">
            Đã chọn <b>{chosen.length}</b> nhân viên{chosenAdd > 0 ? <> · dự kiến cộng <b>+{hv(chosenAdd)}h</b></> : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!chosen.length || pending}
              onClick={() => setAsk({ op: "cancel", ids: chosen, label: `Huỷ tính lại cho ${chosen.length} nhân viên? Giờ công về số chấm công gốc.` })}
            >
              Huỷ tính lại đã chọn
            </Button>
            <Button variant="secondary" disabled={!chosen.length || pending} loading={pending} onClick={() => run("apply", chosen)}>
              Tính lại {chosen.length || ""} đã chọn
            </Button>
            <Button
              disabled={!needIds.length || pending}
              onClick={() => setAsk({ op: "apply", ids: needIds, label: `Tính lại giờ công cho ${needIds.length} nhân viên cần tính?` })}
            >
              Tính lại tất cả ({needIds.length})
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!ask}
        title={ask?.op === "cancel" ? "Huỷ tính lại giờ công" : "Tính lại giờ công"}
        danger={ask?.op === "cancel"}
        confirmLabel={ask?.op === "cancel" ? "Huỷ tính lại" : "Tính lại"}
        cancelLabel="Đóng"
        busy={pending}
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          if (ask) run(ask.op, ask.ids);
          setAsk(null);
        }}
      >
        {ask?.label}
      </ConfirmDialog>
    </div>
  );
}

function ShiftDetail({ r, maxShort }: { r: RecalcRowData; maxShort: number }) {
  return (
    <div className="space-y-2 py-1">
      <p className="text-xs text-ink/70">
        Ca bị làm tròn xuống, thiếu ≤ {maxShort} phút – xếp theo phút thiếu (ít nhất trước). <b className="text-[#c62828]">Đỏ</b> = được cộng +0,5h.
      </p>
      <div className="overflow-x-auto">
        <table className="tbs text-xs">
          <thead>
            <tr>
              <th>Ngày</th>
              <th>Vào – Ra</th>
              <th className="text-right">Thực tế</th>
              <th className="text-right">Chấm công</th>
              <th className="text-right">Thiếu tới mốc</th>
              <th className="text-right">Sau tính lại</th>
              <th>Chênh luỹ kế</th>
            </tr>
          </thead>
          <tbody>
            {r.shifts.map((s) => (
              <tr key={s.id} className={s.picked ? "bg-ok-soft" : "text-ink/60"}>
                <td className="font-semibold">{s.date}</td>
                <td>{s.time}</td>
                <td className="text-right">{s.worked}</td>
                <td className="text-right">{hv(s.rounded)}</td>
                <td className="text-right">{s.shortMin} phút</td>
                <td className="text-right">
                  {s.picked ? (
                    <>
                      <s className="text-ink/50">{hv(s.rounded)}</s> → <b className="text-[#c62828]">{hv(s.rounded + 0.5)}</b>
                    </>
                  ) : (
                    `giữ ${hv(s.rounded)}`
                  )}
                </td>
                <td>{s.picked && s.gapBefore != null && s.gapAfter != null ? `${hmVi(s.gapBefore)} → ${hmVi(s.gapAfter)}` : s.applied ? "Đang cộng – sẽ bỏ" : "Không cần"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
