import { requireAdmin } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { AdjustmentRequest, CoverRequest, PayrollFeedback, Store, User } from "@/lib/models";
import { resolveCover } from "../../actions/cover";
import { weekdayVi } from "@/lib/time";
import { viDate, viDateTime, viMonth } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { ApproveRejectForm } from "@/components/ApproveRejectForm";
import { Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { replyFeedback, resolveAdjustment } from "../../actions/ops";
import TimeInput from "@/components/TimeInput";

export const dynamic = "force-dynamic";

/** Yêu cầu điều chỉnh chấm công + phản hồi bảng lương của nhân viên */
export default async function RequestsPage() {
  const admin = await requireAdmin();
  const canAdj = can(admin, "adjustments"); // duyệt chấm công bù: Admin Tổng hoặc admin được cấp quyền
  const [covers, coversDone, reqs, done, fbs] = await Promise.all([
    CoverRequest.find({ status: "PENDING" }).sort({ date: 1 }).lean(),
    CoverRequest.find({ status: { $ne: "PENDING" } }).sort({ decidedAt: -1 }).limit(10).lean(),
    AdjustmentRequest.find({ status: "PENDING" }).sort({ createdAt: 1 }).lean(),
    AdjustmentRequest.find({ status: { $ne: "PENDING" } }).sort({ resolvedAt: -1 }).limit(15).lean(),
    PayrollFeedback.find().sort({ status: 1, createdAt: -1 }).limit(30).lean(),
  ]);
  const ids = [...reqs, ...done, ...fbs].map((r) => r.userId).concat([...covers, ...coversDone].flatMap((c) => [c.fromUserId, c.toUserId]));
  const users = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const stores = new Map((await Store.find().lean()).map((s) => [String(s._id), s.name]));
  return (
    <>
      <PageTitle>Yêu cầu từ nhân viên</PageTitle>
      <Card title={`Nhờ làm hộ / đổi ca chờ duyệt (${covers.length})`} className="mb-4">
        {covers.length === 0 ? (
          <Empty>Không có yêu cầu</Empty>
        ) : (
          <div className="space-y-3">
            {covers.map((c) => (
              <div key={String(c._id)} className={`rounded-xl p-3 text-sm ${c.kind === "SWAP" ? "bg-[#eff6ff]" : "bg-cream"}`}>
                {c.kind === "SWAP" ? (
                  <>
                    <p>
                      <Badge tone="blue">⇄ Đổi ca</Badge> <b>{users.get(String(c.fromUserId))}</b> ↔ <b>{users.get(String(c.toUserId))}</b>
                    </p>
                    <p>
                      <b>{users.get(String(c.fromUserId))}</b> đưa: {weekdayVi(c.date)} {viDate(c.date)} · Ca {c.shiftName} {c.startTime}–{c.endTime} · {stores.get(String(c.storeId))}
                    </p>
                    <p>
                      <b>{users.get(String(c.toUserId))}</b> đưa: {c.toDate && `${weekdayVi(c.toDate)} ${viDate(c.toDate)}`} · Ca {c.toShiftName} {c.toStartTime}–{c.toEndTime} ·{" "}
                      {stores.get(String(c.toStoreId ?? c.storeId))}
                    </p>
                    <p className="text-xs text-ink/60">Duyệt xong: 2 người hoán đổi ca cho nhau, lịch làm việc cập nhật ngay.</p>
                  </>
                ) : (
                  <>
                    <p>
                      <b>{users.get(String(c.fromUserId))}</b> nhờ <b>{users.get(String(c.toUserId))}</b> làm hộ
                    </p>
                    <p>
                      {weekdayVi(c.date)} {viDate(c.date)} · Ca {c.shiftName} {c.startTime}–{c.endTime} · {stores.get(String(c.storeId))}
                    </p>
                  </>
                )}
                {c.note && <p className="text-ink/70">Lời nhắn: {c.note}</p>}
                <p className="text-xs text-ink/50">Gửi {viDateTime(c.createdAt)}</p>
                <ApproveRejectForm action={resolveCover} approveLabel={c.kind === "SWAP" ? "Duyệt – đổi ca" : "Duyệt – chuyển ca"}>
                  <input type="hidden" name="id" value={String(c._id)} />
                </ApproveRejectForm>
              </div>
            ))}
          </div>
        )}
        {coversDone.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-accent">Đã xử lý gần đây</summary>
            <ul className="mt-2 space-y-1">
              {coversDone.map((c) => (
                <li key={String(c._id)}>
                  {c.kind === "SWAP" ? (
                    <>
                      ⇄ {users.get(String(c.fromUserId))} ({viDate(c.date)} ca {c.shiftName}) ↔ {users.get(String(c.toUserId))} ({c.toDate ? viDate(c.toDate) : ""} ca {c.toShiftName}) ·{" "}
                    </>
                  ) : (
                    <>
                      {users.get(String(c.fromUserId))} → {users.get(String(c.toUserId))} · {viDate(c.date)} ca {c.shiftName} ·{" "}
                    </>
                  )}
                  <Badge tone={c.status === "APPROVED" ? "green" : c.status === "REJECTED" ? "red" : "gray"}>
                    {c.status === "APPROVED" ? "Đã duyệt" : c.status === "REJECTED" ? "Từ chối" : "Đã huỷ"}
                  </Badge>
                  {c.reply && <span className="text-ink/60"> – {c.reply}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <Card title={`Yêu cầu chấm công bù chờ duyệt (${reqs.length})`}>
        {!canAdj && reqs.length > 0 && (
          <p className="mb-2 text-xs text-warn">Chỉ Admin Tổng hoặc admin được Admin Tổng cấp quyền &quot;Duyệt yêu cầu chấm công bù&quot; mới duyệt được – bạn chỉ xem.</p>
        )}
        {reqs.length === 0 ? (
          <Empty>Không có yêu cầu</Empty>
        ) : (
          <div className="space-y-3">
            {reqs.map((r) => (
              <div key={String(r._id)} className="rounded-xl bg-cream p-3 text-sm">
                <p>
                  <b>{users.get(String(r.userId))}</b> · {stores.get(String(r.storeId))} · gửi {viDateTime(r.createdAt)}
                </p>
                <p>Ngày {r.workDate && viDate(r.workDate)}: vào <b>{r.checkInTime || "--"}</b> · ra <b>{r.checkOutTime || "--"}</b></p>
                <p className="text-ink/70">Lý do: {r.reason}</p>
                {canAdj && (
                <ApproveRejectForm action={resolveAdjustment} approveLabel="Duyệt & ghi nhận">
                  <input type="hidden" name="id" value={String(r._id)} />
                  <div className="flex gap-2">
                    <TimeInput name="inTime" defaultValue={r.checkInTime} className="flex-1" title="Giờ vào" />
                    <TimeInput name="outTime" defaultValue={r.checkOutTime} className="flex-1" title="Giờ ra" />
                  </div>
                </ApproveRejectForm>
                )}
              </div>
            ))}
          </div>
        )}
        {done.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-accent">Đã xử lý gần đây</summary>
            <ul className="mt-2 space-y-1">
              {done.map((r) => (
                <li key={String(r._id)}>
                  <Badge tone={r.status === "APPROVED" ? "green" : "red"}>{r.status === "APPROVED" ? "Duyệt" : "Từ chối"}</Badge> {users.get(String(r.userId))} · {r.workDate && viDate(r.workDate)} · {r.adminName} {r.adminReply && `– ${r.adminReply}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <Card title="Phản hồi / khiếu nại bảng lương">
        {fbs.length === 0 ? (
          <Empty>Chưa có phản hồi</Empty>
        ) : (
          <div className="space-y-3">
            {fbs.map((f) => (
              <div key={String(f._id)} className="rounded-xl bg-cream p-3 text-sm">
                <p>
                  <b>{users.get(String(f.userId))}</b> · Tháng {f.month && viMonth(f.month)} ·{" "}
                  <Badge tone={f.status === "OPEN" ? "yellow" : "green"}>{f.status === "OPEN" ? "Chờ xử lý" : "Đã trả lời"}</Badge>
                </p>
                <p className="my-1">{f.content}</p>
                {f.adminReply ? (
                  <p className="text-secondary-dark">↳ {f.adminName}: {f.adminReply}</p>
                ) : (
                  <ActionForm action={replyFeedback} submitLabel="Trả lời" variant="outline" successText="" className="flex items-end gap-1">
                    <input type="hidden" name="id" value={String(f._id)} />
                    <Input name="reply" placeholder="Nội dung trả lời" className="flex-1" />
                  </ActionForm>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
