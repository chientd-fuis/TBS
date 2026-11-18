import { Store, UnpaidOrder } from "@/lib/models";
import { ApproveRejectForm } from "@/components/ApproveRejectForm";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card } from "@/components/ui";
import { viDate, viDateTime, weekdayVi } from "@/lib/time";
import { ESCALATE_MS, escalateUnpaid, sameDayGaps } from "@/lib/unpaid-order";
import { resolveUnpaidAction } from "../../actions/unpaid";

const vnd = (n?: number | null) => (n ? Math.round(n).toLocaleString("vi-VN") : "—");
const STATUS: Record<string, string> = { PAID: "khách đã trả", DISMISSED: "bỏ cảnh báo", PENALIZED: "đã phạt", WAIVED: "không phạt" };

/** Yêu cầu → 🧾 Đơn chưa thanh toán: cảnh báo xác nhận khách đã trả · quá 2 ngày → yêu cầu phạt bù doanh thu. */
export default async function UnpaidCard({ canDecide, who }: { canDecide: boolean; who: (storeId: unknown) => string[] }) {
  await escalateUnpaid().catch(() => 0); // quá 2 ngày → chuyển thành yêu cầu phạt ngay khi mở trang (không chờ cron)
  const [open, done] = await Promise.all([
    UnpaidOrder.find({ status: { $in: ["OPEN", "ESCALATED"] } }).sort({ status: -1, detectedAt: 1 }).limit(60).lean(),
    UnpaidOrder.find({ status: { $nin: ["OPEN", "ESCALATED"] } }).sort({ decidedAt: -1 }).limit(8).lean(),
  ]);
  if (!open.length && !done.length) return null;
  const stores = new Map((await Store.find().select("name").lean()).map((s) => [String(s._id), s.name.replace(/^TBS\s+/i, "")]));
  const gaps = await sameDayGaps(open.filter((u) => u.status === "ESCALATED"));
  const esc = open.filter((u) => u.status === "ESCALATED").length;
  const now = Date.now();
  return (
    <Card title={`🧾 Đơn chưa thanh toán (${open.length}${esc ? ` · ${esc} chờ phạt` : ""})`} className="mb-4">
      <p id="chua-thanh-toan" className="mb-2 scroll-mt-20 text-xs text-ink/60">
        Tự tạo khi ghi chú chốt ca có “chưa TT”, “chưa thanh toán”, “khách nợ”… Xác nhận khách đã chuyển chưa – <b>quá 2 ngày</b> chưa xác nhận thì thành{" "}
        <b>yêu cầu phạt bù doanh thu</b> (đơn không đòi được khách), phạt người chốt ca.
      </p>
      <div className="space-y-3">
        {open.map((u) => {
          const escalated = u.status === "ESCALATED";
          const left = Math.max(0, (u.detectedAt ? new Date(u.detectedAt).getTime() : now) + ESCALATE_MS - now);
          const gap = gaps.get(`${u.storeId}|${u.date}`);
          return (
            <div key={String(u._id)} className={`space-y-2 rounded-xl p-3 text-sm ring-1 ${escalated ? "bg-bad-bg/40 ring-bad-line" : "bg-cream ring-line"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b>
                  {stores.get(String(u.storeId))} · {viDate(u.date).slice(0, 5)} ({weekdayVi(u.date)}) · Ca {u.shiftName || "?"} – {u.name}
                </b>
                {escalated ? <Badge tone="red">Quá 2 ngày → chờ phạt</Badge> : <Badge tone="orange">Chờ xác nhận · còn {Math.ceil(left / 3_600_000)} giờ</Badge>}
              </div>
              <p>
                {escalated ? "Đơn chưa thanh toán không đòi được khách" : "Ca có 1 đơn chưa thanh toán – cần xác nhận khách đã chuyển chưa"}:{" "}
                <b className="text-danger">{u.amount ? `${vnd(u.amount)} đ` : "chưa rõ số tiền"}</b>
              </p>
              <div className="rounded-lg bg-card px-3 py-1.5 text-[13px]">
                {((u.quotes ?? []) as string[]).map((q, i) => (
                  <p key={i}>📝 “{q}”</p>
                ))}
              </div>
              {escalated && gap && (
                <p className="rounded-lg bg-warn-soft px-3 py-1.5 text-xs text-late-fg">
                  ⚠ Ngày này cũng có yêu cầu <b>Bù doanh thu</b> (thiếu {vnd(-gap.total)} đ, {gap.status === "PENDING" ? "đang chờ" : gap.status === "APPROVED" ? "đã phạt" : "không phạt"}) – đơn
                  chưa trả thường đã nằm trong số thiếu đó, tránh phạt 2 lần.
                </p>
              )}
              {canDecide ? (
                <>
                  {escalated ? (
                    <ApproveRejectForm action={resolveUnpaidAction} approveLabel="Duyệt – ghi phạt" rejectLabel="Không phạt" placeholder="Ghi chú cho nhân viên (tuỳ chọn)">
                      <input type="hidden" name="id" value={String(u._id)} />
                      <input type="hidden" name="stage" value="ESCALATED" />
                      <label className="flex items-center gap-2 text-[13px]">
                        Phạt <b>{u.name}</b> (người chốt ca)
                        <input
                          name="amount"
                          inputMode="numeric"
                          defaultValue={u.amount ? String(u.amount) : ""}
                          placeholder="Số tiền"
                          disabled={!u.userId}
                          className="h-9 w-28 rounded-lg bg-card px-2 text-right text-sm ring-1 ring-line-strong"
                        />
                        đ
                      </label>
                      {!u.userId && <p className="text-xs text-danger">Ca không rõ người chốt – chỉ Không phạt / ghi phạt tay ở Thưởng / Phạt.</p>}
                    </ApproveRejectForm>
                  ) : (
                    <ApproveRejectForm action={resolveUnpaidAction} approveLabel="✓ Khách đã trả" rejectLabel="Không phải đơn nợ" placeholder="Ghi chú (tuỳ chọn)">
                      <input type="hidden" name="id" value={String(u._id)} />
                      <input type="hidden" name="stage" value="OPEN" />
                    </ApproveRejectForm>
                  )}
                  {escalated && (
                    <ActionForm action={resolveUnpaidAction} submitLabel="✓ Khách đã trả (không phạt)" successText="Đã ghi khách đã trả" variant="outline">
                      <input type="hidden" name="id" value={String(u._id)} />
                      <input type="hidden" name="stage" value="ESCALATED" />
                      <input type="hidden" name="op" value="paid" />
                    </ActionForm>
                  )}
                  <p className="text-xs text-ink/60">👤 Cần {who(u.storeId).join(", ")} xác nhận</p>
                </>
              ) : (
                <p className="text-xs text-ink/60">👤 Cần {who(u.storeId).join(", ")} xác nhận (quyền Doanh thu)</p>
              )}
            </div>
          );
        })}
      </div>
      {done.length > 0 && (
        <details className="mt-3 text-[13px]">
          <summary className="cursor-pointer text-ink/70">Đã xử lý gần đây ({done.length})</summary>
          <ul className="mt-2 space-y-1">
            {done.map((u) => (
              <li key={String(u._id)}>
                {stores.get(String(u.storeId))} {viDate(u.date).slice(0, 5)} · Ca {u.shiftName} – {u.name} · {vnd(u.amount)} đ →{" "}
                <b className={u.status === "PENALIZED" ? "text-danger" : ""}>
                  {STATUS[u.status] ?? u.status}
                  {u.status === "PENALIZED" ? ` ${vnd(u.penalty)} đ` : ""}
                </b>{" "}
                ({u.decidedBy}
                {u.decidedAt ? `, ${viDateTime(u.decidedAt)}` : ""})
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
