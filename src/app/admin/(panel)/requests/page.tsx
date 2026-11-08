import { requireAdmin } from "@/lib/guards";
import { AdjustmentRequest, CoverRequest, PayrollFeedback, Store, User } from "@/lib/models";
import { resolveCover } from "../../actions/cover";
import { weekdayVi } from "@/lib/time";
import { viDate, viDateTime, viMonth } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { replyFeedback, resolveAdjustment } from "../../actions/ops";
import TimeInput from "@/components/TimeInput";

export const dynamic = "force-dynamic";

/** Yêu cầu điều chỉnh chấm công + phản hồi bảng lương của nhân viên */
export default async function RequestsPage() {
  await requireAdmin();
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
      <Card title={`Nhờ làm hộ ca chờ duyệt (${covers.length})`} className="mb-4">
        {covers.length === 0 ? (
          <Empty>Không có yêu cầu</Empty>
        ) : (
          <div className="space-y-3">
            {covers.map((c) => (
              <div key={String(c._id)} className="rounded-xl bg-cream p-3 text-sm">
                <p>
                  <b>{users.get(String(c.fromUserId))}</b> nhờ <b>{users.get(String(c.toUserId))}</b> làm hộ
                </p>
                <p>
                  {weekdayVi(c.date)} {viDate(c.date)} · Ca {c.shiftName} {c.startTime}–{c.endTime} · {stores.get(String(c.storeId))}
                </p>
                {c.note && <p className="text-ink/70">Lời nhắn: {c.note}</p>}
                <p className="text-xs text-ink/50">Gửi {viDateTime(c.createdAt)}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={resolveCover} submitLabel="Duyệt – chuyển ca" variant="secondary" successText="" className="flex flex-wrap items-end gap-1">
                    <input type="hidden" name="id" value={String(c._id)} />
                    <input type="hidden" name="op" value="approve" />
                    <Input name="reply" placeholder="Ghi chú (tuỳ chọn)" className="w-44" />
                  </ActionForm>
                  <ActionForm action={resolveCover} submitLabel="Từ chối" variant="outline" successText="" className="flex items-end gap-1">
                    <input type="hidden" name="id" value={String(c._id)} />
                    <input type="hidden" name="op" value="reject" />
                    <Input name="reply" placeholder="Lý do từ chối" className="w-40" />
                  </ActionForm>
                </div>
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
                  {users.get(String(c.fromUserId))} → {users.get(String(c.toUserId))} · {viDate(c.date)} ca {c.shiftName} ·{" "}
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
      <Card title={`Điều chỉnh chấm công chờ duyệt (${reqs.length})`}>
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
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionForm action={resolveAdjustment} submitLabel="Duyệt & ghi nhận" variant="secondary" successText="" className="flex flex-wrap items-end gap-1">
                    <input type="hidden" name="id" value={String(r._id)} />
                    <input type="hidden" name="op" value="approve" />
                    <TimeInput name="inTime" defaultValue={r.checkInTime} className="w-28" title="Giờ vào" />
                    <TimeInput name="outTime" defaultValue={r.checkOutTime} className="w-28" title="Giờ ra" />
                    <Input name="reply" placeholder="Ghi chú" className="w-40" />
                  </ActionForm>
                  <ActionForm action={resolveAdjustment} submitLabel="Từ chối" variant="outline" successText="" className="flex items-end gap-1">
                    <input type="hidden" name="id" value={String(r._id)} />
                    <input type="hidden" name="op" value="reject" />
                    <Input name="reply" placeholder="Lý do từ chối" className="w-40" />
                  </ActionForm>
                </div>
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
