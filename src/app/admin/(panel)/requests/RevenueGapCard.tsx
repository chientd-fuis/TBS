import { RevenueGap, Store } from "@/lib/models";
import { ApproveRejectForm } from "@/components/ApproveRejectForm";
import { Badge, Card } from "@/components/ui";
import { viDate, weekdayVi } from "@/lib/time";
import { resolveRevenueGap } from "../../actions/revenue-import";
import type { GapNote, GapPart } from "@/lib/revenue-gap";

type Gap = { _id: unknown; storeId: unknown; date: string; status: string; dt?: number | null; real?: number | null; total?: number | null; lastShift?: string | null; parts?: GapPart[]; notes?: GapNote[]; penalties?: { amount?: number }[]; decidedBy?: string | null; totalAfterDecision?: number | null };

const vnd = (n?: number | null) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));
const sgn = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("vi-VN")}`;
const SRC: Record<string, string> = { calc: "Tự tính theo số chốt từng ca", note: "Theo ghi chú nhân viên", rest: "Phần còn lại của cả ngày" };

/** Yêu cầu → 💸 Bù doanh thu (thiếu tiền): chia theo ca, sửa số phạt từng người, ghi chú cần biết → Duyệt (ghi phạt) / Không phạt. */
export default async function RevenueGapCard({ canDecide, who }: { canDecide: boolean; who: (storeId: unknown) => string[] }) {
  const [pending, done] = await Promise.all([
    RevenueGap.find({ status: "PENDING" }).sort({ date: -1 }).limit(60).lean() as unknown as Promise<Gap[]>,
    RevenueGap.find({ status: { $ne: "PENDING" } }).sort({ decidedAt: -1 }).limit(8).lean() as unknown as Promise<Gap[]>,
  ]);
  if (!pending.length && !done.length) return null;
  const stores = new Map((await Store.find().select("name").lean()).map((s) => [String(s._id), s.name.replace(/^TBS\s+/i, "")]));
  return (
    <Card title={`💸 Bù doanh thu (thiếu tiền) chờ duyệt (${pending.length})`} className="mb-4">
      <p id="bu-doanh-thu" className="mb-2 scroll-mt-20 text-xs text-ink/60">
        Tự tạo khi ngày thiếu tiền (thực thu &lt; DT máy) lúc nhân viên chốt ca, admin sửa DT máy hoặc import DT máy KiotViet. Duyệt = ghi phạt từng người theo số bên
        dưới (sửa được); ca dư tiền không phạt.
      </p>
      <div className="space-y-3">
        {pending.map((g) => {
          const others = (g.parts ?? []).filter((p) => p.source !== "rest").reduce((s, p) => s + (p.amount ?? 0), 0);
          const sum = (g.parts ?? []).reduce((s, p) => s + Math.max(0, -(p.amount ?? 0)), 0);
          const names = who(g.storeId);
          return (
            <div key={String(g._id)} className="space-y-2 rounded-xl bg-cream p-3 text-sm ring-1 ring-line">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>
                  {stores.get(String(g.storeId))} · {viDate(g.date).slice(0, 5)} ({weekdayVi(g.date)})
                </b>
                <Badge tone="red">Thiếu {vnd(-(g.total ?? 0))}</Badge>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 rounded-lg bg-card px-3 py-2 text-[13px]">
                <span>DT máy (ca {g.lastShift})</span>
                <b className="text-right">{vnd(g.dt)}</b>
                <span>Thực thu (TM + TK + thu chi + Grab/Shopee)</span>
                <b className="text-right">{vnd(g.real)}</b>
                <span>Lệch cả ngày</span>
                <b className="text-right text-danger">{sgn(g.total ?? 0)}</b>
              </div>
              {canDecide ? (
                <ApproveRejectForm action={resolveRevenueGap} approveLabel={`Duyệt – ghi phạt`} rejectLabel="Không phạt" placeholder="Ghi chú cho nhân viên (tuỳ chọn)">
                  <input type="hidden" name="id" value={String(g._id)} />
                  <p className="font-semibold">Chia theo ca · số phạt (sửa được)</p>
                  <div className="space-y-2">
                    {(g.parts ?? []).map((p, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 text-[13px]">
                          Ca {p.shiftName} · <b>{p.name}</b> <span className={(p.amount ?? 0) < 0 ? "text-danger" : "text-good"}>{sgn(p.amount ?? 0)}</span>
                          <span className="block text-xs text-ink/60">
                            {SRC[p.source ?? ""] ?? ""}
                            {p.quote ? `: “${p.quote}”` : ""}
                            {p.source === "rest" && others ? ` (= ${sgn(g.total ?? 0)} − (${sgn(others)}))` : ""}
                            {(p.amount ?? 0) > 0 ? " · dư tiền – không phạt" : ""}
                          </span>
                        </span>
                        <label className="flex items-center gap-1 text-xs">
                          Phạt
                          <input
                            name={`amt_${i}`}
                            inputMode="numeric"
                            defaultValue={(p.amount ?? 0) < 0 ? String(-(p.amount ?? 0)) : "0"}
                            disabled={!p.userId}
                            aria-label={`Phạt ca ${p.shiftName}`}
                            className="h-9 w-24 rounded-lg bg-card px-2 text-right text-sm ring-1 ring-line-strong"
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                  {(g.notes ?? []).length > 0 && (
                    <div className="space-y-1 rounded-lg bg-warn-soft px-3 py-2 text-[13px]">
                      <b className="text-xs text-late-fg">Ghi chú cần biết (từ chốt ca)</b>
                      {(g.notes ?? []).map((n, i) => (
                        <p key={i}>
                          {n.kind === "unpaid" ? <b className="text-danger">⚠ Đơn chưa thanh toán · </b> : "• "}Ca {n.shiftName}: {n.text}
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-ink/60">Tổng gợi ý phạt: {vnd(sum)} · 👤 Cần {names.join(", ")} xác nhận</p>
                </ApproveRejectForm>
              ) : (
                <p className="text-xs text-ink/60">👤 Cần {names.join(", ")} xác nhận (quyền Doanh thu)</p>
              )}
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-ink/70">Đã xử lý gần đây ({done.length})</summary>
          <ul className="mt-2 space-y-1">
            {done.map((g) => (
              <li key={String(g._id)}>
                {stores.get(String(g.storeId))} {viDate(g.date).slice(0, 5)} · thiếu {vnd(-(g.total ?? 0))} →{" "}
                {g.status === "APPROVED" ? <b className="text-danger">phạt {vnd((g.penalties ?? []).reduce((s, p) => s + (p.amount ?? 0), 0))}</b> : <b>không phạt</b>} ({g.decidedBy})
                {g.totalAfterDecision != null && g.totalAfterDecision !== g.total && <span className="text-late-fg"> · số đã đổi sau khi duyệt: lệch {sgn(g.totalAfterDecision)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
