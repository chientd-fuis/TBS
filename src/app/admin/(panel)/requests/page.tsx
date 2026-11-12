import { requireAdmin } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { AdjustmentRequest, Attendance, CoverRequest, PayrollFeedback, Store, User } from "@/lib/models";
import { resolveOvertime } from "../../actions/overtime";
import { durVi, OVERTIME_GRACE_MIN } from "@/lib/overtime";
import { adminDirectory, APPROVE_PERM } from "@/lib/admin-stores";
import { attText, compareWarnings, dayAttendances, pickTarget, requestWindow } from "@/lib/adjustment";
import { localTime } from "@/lib/time";
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
  // làm thêm giờ (check-out quá giờ hết ca > 30 phút) chờ xác nhận + 10 cái vừa xử lý
  // mọi admin đều thấy; ai có quyền duyệt đều duyệt được – tên admin quản lý cơ sở chỉ để gắn trách nhiệm (dòng "Cần … xác nhận")
  const [ots, otsDone] = await Promise.all([
    Attendance.find({ "overtime.status": "PENDING" }).sort({ checkOutAt: 1 }).lean(),
    Attendance.find({ "overtime.status": { $in: ["APPROVED", "REJECTED"] } }).sort({ "overtime.decidedAt": -1 }).limit(10).lean(),
  ]);
  const ids = [...reqs, ...done, ...fbs, ...ots, ...otsDone].map((r) => r.userId).concat([...covers, ...coversDone].flatMap((c) => [c.fromUserId, c.toUserId]));
  const users = new Map((await User.find({ _id: { $in: ids } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const storeList = await Store.find().lean();
  const stores = new Map(storeList.map((s) => [String(s._id), s.name]));
  const tzOf = new Map(storeList.map((s) => [String(s._id), s.timezone || "Asia/Ho_Chi_Minh"]));
  const hm = (d: Date | null | undefined, storeId: unknown) => (d ? localTime(d, tzOf.get(String(storeId))).slice(0, 5) : "—");
  // yêu cầu chấm công bù: các lượt app đã ghi trong ngày + lượt sẽ sửa (chọn sẵn theo giờ) + cảnh báo so với giờ app ghi
  const adjCtx = new Map(
    await Promise.all(
      reqs.map(async (r) => {
        const tz = tzOf.get(String(r.storeId)) || "Asia/Ho_Chi_Minh";
        const list = r.workDate ? await dayAttendances(r.userId, r.workDate) : [];
        const { reqIn, reqOut } = r.workDate ? requestWindow(r.workDate, r.checkInTime, r.checkOutTime, tz) : { reqIn: null, reqOut: null };
        const target = pickTarget(list, reqIn, reqOut);
        return [String(r._id), { tz, list, targetId: target ? String(target._id) : null, warnings: compareWarnings(target, reqIn, reqOut) }] as const;
      }),
    ),
  );
  // ai cần xác nhận (admin quản lý cơ sở có quyền duyệt) – yêu cầu của chính người đang xem thì tô cam
  const who = await adminDirectory();
  const me = admin.kind === "OWNER" ? "Admin Tổng" : admin.name;
  const Who = ({ storeId, perm }: { storeId: unknown; perm: string | null }) => {
    const names = who(storeId, perm);
    return <p className={`text-xs ${names.includes(me) ? "font-semibold text-warn" : "text-ink/60"}`}>👤 Cần {names.join(", ")} xác nhận</p>;
  };
  return (
    <>
      <PageTitle>Yêu cầu từ nhân viên</PageTitle>
      <Card title={`⏱ Làm thêm giờ chờ xác nhận (${ots.length})`} className="mb-4">
        <p className="mb-2 text-xs text-ink/60">
          Nhân viên check-out quá giờ hết ca được xếp hơn {OVERTIME_GRACE_MIN} phút (không được xếp ca sau). <b>Duyệt</b> = tính đủ giờ làm thêm. <b>Từ chối</b> = chỉ tính công tới
          giờ hết ca, bỏ giờ làm thêm. Mỗi yêu cầu ghi tên admin quản lý cơ sở để gắn trách nhiệm – admin nào được cấp quyền cũng duyệt được.
        </p>
        {!canAdj && ots.length > 0 && <p className="mb-2 text-xs text-warn">Cần quyền &quot;Duyệt yêu cầu chấm công bù&quot; để xác nhận – bạn chỉ xem.</p>}
        {ots.length === 0 ? (
          <Empty>Không có giờ làm thêm chờ xác nhận</Empty>
        ) : (
          <div className="space-y-3">
            {ots.map((a) => (
              <div key={String(a._id)} className="rounded-xl bg-[#fff7ed] p-3 text-sm ring-1 ring-[#fed7aa]">
                <p>
                  <b>{users.get(String(a.userId))}</b> · {stores.get(String(a.storeId))} · {weekdayVi(a.workDate)} {viDate(a.workDate)}
                </p>
                <p>
                  Ca được xếp <b>{a.overtime?.shiftLabel}</b> · vào {hm(a.checkInAt, a.storeId)} → ra <b>{hm(a.checkOutAt, a.storeId)}</b>
                </p>
                <p className="font-semibold text-warn">
                  ➕ Làm thêm {durVi(a.overtime?.minutes ?? 0)} sau giờ hết ca {hm(a.overtime?.shiftEnd, a.storeId)} · đang tính {a.roundedHours ?? 0}h công
                </p>
                <Who storeId={a.storeId} perm={APPROVE_PERM.overtime} />
                {canAdj && (
                  <ApproveRejectForm action={resolveOvertime} approveLabel="Duyệt làm thêm" placeholder="Ghi chú (tuỳ chọn)">
                    <input type="hidden" name="id" value={String(a._id)} />
                  </ApproveRejectForm>
                )}
              </div>
            ))}
          </div>
        )}
        {otsDone.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-accent">Đã xử lý gần đây</summary>
            <ul className="mt-2 space-y-1 text-xs">
              {otsDone.map((a) => (
                <li key={String(a._id)}>
                  {users.get(String(a.userId))} · {viDate(a.workDate)} · làm thêm {durVi(a.overtime?.minutes ?? 0)}{" "}
                  <Badge tone={a.overtime?.status === "APPROVED" ? "green" : "red"}>{a.overtime?.status === "APPROVED" ? "Đã duyệt" : "Từ chối – tính tới hết ca"}</Badge>{" "}
                  {a.overtime?.decidedBy && <span className="text-ink/60">· {a.overtime.decidedBy}</span>}
                  {a.overtime?.reply && <span className="text-ink/60"> – {a.overtime.reply}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
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
                <Who storeId={c.storeId} perm={APPROVE_PERM.cover} />
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
                <p>
                  NV xin ngày {r.workDate && viDate(r.workDate)}: vào <b>{r.checkInTime || "--"}</b> · ra <b>{r.checkOutTime || "--"}</b>
                </p>
                <p className="text-ink/70">Lý do: {r.reason}</p>
                {(() => {
                  const ctx = adjCtx.get(String(r._id));
                  if (!ctx) return null;
                  return (
                    <div className="mt-1 space-y-1 rounded-lg bg-white/70 p-2 text-xs ring-1 ring-[#f1e6c8]">
                      <p className="font-semibold text-ink/70">
                        App đang ghi ngày này: {ctx.list.length ? `${ctx.list.length} lượt` : "không có lượt nào"}
                      </p>
                      {ctx.warnings.map((w) => (
                        <p key={w} className="font-semibold text-warn">
                          ⚠ {w}
                        </p>
                      ))}
                    </div>
                  );
                })()}
                <Who storeId={r.storeId} perm={APPROVE_PERM.adjustment} />
                {canAdj && (
                <ApproveRejectForm action={resolveAdjustment} approveLabel="Duyệt & ghi nhận">
                  <input type="hidden" name="id" value={String(r._id)} />
                  {/* chọn lượt sẽ sửa (ngày làm 2 ca có nhiều lượt) – máy chọn sẵn theo giờ, admin đổi được */}
                  {(() => {
                    const ctx = adjCtx.get(String(r._id));
                    if (!ctx) return null;
                    return (
                      <fieldset className="space-y-1 rounded-lg bg-cream p-2 text-xs ring-1 ring-[#f1e6c8]">
                        <legend className="px-1 font-semibold text-accent">Duyệt sẽ sửa lượt:</legend>
                        {ctx.list.map((a) => (
                          <label key={String(a._id)} className="flex items-start gap-2">
                            <input type="radio" name="targetId" value={String(a._id)} defaultChecked={String(a._id) === ctx.targetId} className="mt-0.5 accent-[#3c9c54]" />
                            <span>
                              {a.shiftLabel ? <b>{a.shiftLabel}</b> : <b>Ngoài ca</b>}: {attText(a, ctx.tz)}
                              {stores.get(String(a.storeId)) && String(a.storeId) !== String(r.storeId) && <span className="text-ink/50"> · {stores.get(String(a.storeId))}</span>}
                              {String(a._id) === ctx.targetId && <span className="ml-1 rounded bg-secondary px-1 text-[10px] font-bold text-white">chọn sẵn</span>}
                            </span>
                          </label>
                        ))}
                        <label className="flex items-start gap-2">
                          <input type="radio" name="targetId" value="new" defaultChecked={!ctx.targetId} className="mt-0.5 accent-[#3c9c54]" />
                          <span>
                            <b>Thêm lượt mới</b> (quên cả check-in lẫn check-out ca này)
                            {!ctx.targetId && <span className="ml-1 rounded bg-secondary px-1 text-[10px] font-bold text-white">chọn sẵn</span>}
                          </span>
                        </label>
                      </fieldset>
                    );
                  })()}
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
