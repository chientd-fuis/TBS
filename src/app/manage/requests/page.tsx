import { requireStaff } from "@/lib/staff-guard";
import { CoverRequest, Store, User } from "@/lib/models";
import { viDate, viDateTime, weekdayVi } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { staffResolveCover } from "../actions";

export const dynamic = "force-dynamic";

/** Duyệt nhờ làm hộ / đổi ca ở cơ sở được giao (không tự duyệt yêu cầu có mình trong đó). */
export default async function ManageRequests() {
  const { user, stores } = await requireStaff("cover");
  const inMine = { $or: [{ storeId: { $in: stores } }, { toStoreId: { $in: stores } }] };
  const [pending, done] = await Promise.all([
    CoverRequest.find({ status: "PENDING", ...inMine }).sort({ date: 1 }).lean(),
    CoverRequest.find({ status: { $ne: "PENDING" }, ...inMine }).sort({ decidedAt: -1 }).limit(15).lean(),
  ]);
  const ids = [...pending, ...done].flatMap((c) => [c.fromUserId, c.toUserId]);
  const users = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const storeName = new Map((await Store.find().select("name").lean()).map((s) => [String(s._id), s.name]));
  const me = String(user._id);
  return (
    <>
      <PageTitle sub="Duyệt xong lịch làm việc tự cập nhật và nhân viên nhận thông báo. Thao tác được ghi lại cho admin cơ sở.">Duyệt đổi ca / làm hộ</PageTitle>
      <Card title={`Chờ duyệt (${pending.length})`}>
        {!pending.length ? (
          <Empty>Không có yêu cầu</Empty>
        ) : (
          <div className="space-y-3">
            {pending.map((c) => {
              const own = [String(c.fromUserId), String(c.toUserId)].includes(me);
              return (
                <div key={String(c._id)} className={`rounded-xl p-3 text-sm ${c.kind === "SWAP" ? "bg-[#eff6ff]" : "bg-cream"}`}>
                  {c.kind === "SWAP" ? (
                    <>
                      <p><Badge tone="blue">⇄ Đổi ca</Badge> <b>{users.get(String(c.fromUserId))}</b> ↔ <b>{users.get(String(c.toUserId))}</b></p>
                      <p><b>{users.get(String(c.fromUserId))}</b> đưa: {weekdayVi(c.date)} {viDate(c.date)} · Ca {c.shiftName} {c.startTime}–{c.endTime} · {storeName.get(String(c.storeId))}</p>
                      <p><b>{users.get(String(c.toUserId))}</b> đưa: {c.toDate && `${weekdayVi(c.toDate)} ${viDate(c.toDate)}`} · Ca {c.toShiftName} {c.toStartTime}–{c.toEndTime} · {storeName.get(String(c.toStoreId ?? c.storeId))}</p>
                    </>
                  ) : (
                    <>
                      <p><b>{users.get(String(c.fromUserId))}</b> nhờ <b>{users.get(String(c.toUserId))}</b> làm hộ</p>
                      <p>{weekdayVi(c.date)} {viDate(c.date)} · Ca {c.shiftName} {c.startTime}–{c.endTime} · {storeName.get(String(c.storeId))}</p>
                    </>
                  )}
                  {c.note && <p className="text-ink/70">Lời nhắn: {c.note}</p>}
                  <p className="text-xs text-ink/50">Gửi {viDateTime(c.createdAt)}</p>
                  {own ? (
                    <p className="mt-2 text-xs text-warn">Yêu cầu có bạn trong đó – nhờ admin hoặc người quản lý khác duyệt.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <ActionForm action={staffResolveCover} submitLabel={c.kind === "SWAP" ? "Duyệt – đổi ca" : "Duyệt – chuyển ca"} variant="secondary" successText="" className="flex flex-wrap items-end gap-1">
                        <input type="hidden" name="id" value={String(c._id)} />
                        <input type="hidden" name="op" value="approve" />
                        <Input name="reply" placeholder="Ghi chú (tuỳ chọn)" className="w-44" />
                      </ActionForm>
                      <ActionForm action={staffResolveCover} submitLabel="Từ chối" variant="outline" successText="" className="flex items-end gap-1">
                        <input type="hidden" name="id" value={String(c._id)} />
                        <input type="hidden" name="op" value="reject" />
                        <Input name="reply" placeholder="Lý do từ chối" className="w-40" />
                      </ActionForm>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      {done.length > 0 && (
        <Card title="Đã xử lý gần đây">
          <ul className="space-y-1 text-sm">
            {done.map((c) => (
              <li key={String(c._id)}>
                {c.kind === "SWAP" ? "⇄ " : ""}
                {users.get(String(c.fromUserId))} → {users.get(String(c.toUserId))} · {viDate(c.date)} ca {c.shiftName} ·{" "}
                <Badge tone={c.status === "APPROVED" ? "green" : c.status === "REJECTED" ? "red" : "gray"}>
                  {c.status === "APPROVED" ? "Đã duyệt" : c.status === "REJECTED" ? "Từ chối" : "Đã huỷ"}
                </Badge>
                {c.decidedBy && <span className="text-xs text-ink/60"> · {c.decidedBy}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
