import { requireAdmin } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { AdjustmentRequest, Attendance, CoverRequest, PayrollFeedback, Store, User } from "@/lib/models";
import { resolveOvertime } from "../../actions/overtime";
import { extraKinds, hoursShort, OVERTIME_GRACE_MIN } from "@/lib/overtime";
import { adminDirectory, APPROVE_PERM } from "@/lib/admin-stores";
import { attendancesNear, attText, compareWarnings, dayAttendances, findOverlap, pickTarget, requestWindow } from "@/lib/adjustment";
import { findShiftFor } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { roundedHours } from "@/lib/calc";
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
  // làm ngoài giờ (ra muộn > 30 phút / vào sớm / ngoài ca) chờ xác nhận + 10 cái vừa xử lý
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
  const st = await getSettings();
  const roundCfg = { stepHours: st.roundStepHours, graceMinutes: st.roundGraceMinutes, graceHourMinutes: st.roundGraceHourMinutes ?? st.roundGraceMinutes };
  // yêu cầu chấm công bù: các lượt app đã ghi trong ngày + lượt sẽ sửa (chọn sẵn theo giờ) + cảnh báo so với giờ app ghi
  const adjCtx = new Map(
    await Promise.all(
      reqs.map(async (r) => {
        const tz = tzOf.get(String(r.storeId)) || "Asia/Ho_Chi_Minh";
        const list = r.workDate ? await dayAttendances(r.userId, r.workDate) : [];
        const { reqIn, reqOut } = r.workDate ? requestWindow(r.workDate, r.checkInTime, r.checkOutTime, tz) : { reqIn: null, reqOut: null };
        // sửa giờ: đúng lượt đã chọn (null = lượt đã bị xoá) · chấm bù: thêm mới · kiểu cũ: đoán theo giờ
        const target =
          r.kind === "EDIT" ? (list.find((a) => String(a._id) === String(r.attendanceId)) ?? null) : r.kind === "MISSING" ? null : pickTarget(list, reqIn, reqOut);
        const warnings = r.kind === "MISSING" ? [] : r.kind === "EDIT" && !target ? [] : compareWarnings(target, reqIn, reqOut);
        // sửa giờ: lượt đã bị đổi sau khi nhân viên gửi (admin sửa / nhân viên tự check-out lại…)
        const changedSince =
          r.kind === "EDIT" && target && r.before
            ? String(target.checkInAt) !== String(r.before.checkInAt) || String(target.checkOutAt ?? "") !== String(r.before.checkOutAt ?? "")
            : false;
        // chấm bù: trùng lượt đã có (có thể vừa được chấm hộ) + ca được xếp khớp giờ xin
        const clash = r.kind === "MISSING" && reqIn && reqOut ? findOverlap(await attendancesNear(r.userId, reqIn, reqOut), reqIn, reqOut) : null;
        const shift = r.kind === "MISSING" && reqIn ? await findShiftFor(String(r.userId), reqIn, tz) : null;
        const reqHours = reqIn && reqOut ? roundedHours(reqIn, reqOut, roundCfg) : null;
        return [String(r._id), { tz, list, target, targetId: target ? String(target._id) : null, warnings, changedSince, clash, shift, reqHours }] as const;
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
      <Card title={`⏱ Làm ngoài giờ chờ xác nhận (${ots.length})`} className="mb-4">
        <p id="ngoai-gio" className="mb-2 text-xs text-ink/60">
          Gồm: <b>ra muộn</b> quá giờ hết ca được xếp hơn {OVERTIME_GRACE_MIN} phút · <b>vào sớm</b> trước giờ ca làm tăng giờ công · <b>ngoài ca</b> (không được xếp ca).
          Mặc định <b>vẫn tính công</b> (đã cộng vào bảng lương). <b>Duyệt</b> = giữ nguyên. <b>Từ chối</b> = bỏ phần ngoài giờ: tính từ đầu ca / tới hết ca, lượt ngoài ca
          thành 0 giờ. Mỗi yêu cầu ghi tên admin quản lý cơ sở để gắn trách nhiệm – admin nào được cấp quyền cũng duyệt được.
        </p>
        {!canAdj && ots.length > 0 && <p className="mb-2 text-xs text-warn">Cần quyền &quot;Duyệt yêu cầu chấm công bù&quot; để xác nhận – bạn chỉ xem.</p>}
        {ots.length === 0 ? (
          <Empty>Không có giờ làm ngoài giờ chờ xác nhận</Empty>
        ) : (
          <div className="space-y-3">
            {ots.map((a) => (
              <div key={String(a._id)} className="rounded-xl bg-[#fff7ed] p-3 text-sm ring-1 ring-[#fed7aa]">
                <p>
                  <b>{users.get(String(a.userId))}</b> · {stores.get(String(a.storeId))} · {weekdayVi(a.workDate)} {viDate(a.workDate)}
                </p>
                <p>
                  {a.overtime?.outOfShift ? (
                    <>
                      <b>Không được xếp ca</b>
                    </>
                  ) : (
                    <>
                      Ca được xếp <b>{a.overtime?.shiftLabel}</b>
                    </>
                  )}{" "}
                  · vào <b>{hm(a.checkInAt, a.storeId)}</b> → ra <b>{hm(a.checkOutAt, a.storeId)}</b>
                </p>
                {extraKinds(a.overtime ?? {}).map((k) => (
                  <p key={k} className="font-semibold text-warn">
                    ➕ {k}
                  </p>
                ))}
                <p className="text-xs text-ink/70">
                  Đang tính {a.roundedHours ?? 0}h công
                  {a.overtime?.deltaHours ? (
                    <>
                      {" "}
                      (gồm <b>+{hoursShort(a.overtime.deltaHours)}</b> ngoài giờ) · Từ chối →{" "}
                      {a.overtime.outOfShift ? "0 giờ" : `còn ${hoursShort(Math.max(0, (a.roundedHours ?? 0) - a.overtime.deltaHours))}`}
                    </>
                  ) : null}
                </p>
                <Who storeId={a.storeId} perm={APPROVE_PERM.overtime} />
                {canAdj && (
                  <ApproveRejectForm action={resolveOvertime} approveLabel={a.overtime?.outOfShift ? "Duyệt công ngoài ca" : "Duyệt ngoài giờ"} placeholder="Ghi chú (tuỳ chọn)">
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
                  {users.get(String(a.userId))} · {viDate(a.workDate)} · {extraKinds(a.overtime ?? {}).join(" · ") || "làm ngoài giờ"}{" "}
                  <Badge tone={a.overtime?.status === "APPROVED" ? "green" : "red"}>
                    {a.overtime?.status === "APPROVED" ? "Đã duyệt" : a.overtime?.outOfShift ? "Từ chối – 0 giờ" : "Từ chối – chỉ tính trong ca"}
                  </Badge>{" "}
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
            {reqs.map((r) => {
              const ctx = adjCtx.get(String(r._id))!;
              const kind = r.kind as "EDIT" | "MISSING" | undefined;
              const t = ctx.target;
              return (
              <div
                key={String(r._id)}
                className={`space-y-1 rounded-xl p-3 text-sm ${kind === "EDIT" ? "bg-[#f5f9ff] ring-1 ring-[#c7dbfb]" : kind === "MISSING" ? "bg-[#faf5ff] ring-1 ring-[#e3d0f7]" : "bg-cream"}`}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {kind && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold text-white ${kind === "EDIT" ? "bg-[#1e3a8a]" : "bg-[#6b21a8]"}`}>
                      {kind === "EDIT" ? "Sửa giờ lượt đã chấm" : "Chấm bù ca (quên chấm công)"}
                    </span>
                  )}
                  <span>
                    <b>{users.get(String(r.userId))}</b> · {stores.get(String(r.storeId))} · {r.workDate && `${weekdayVi(r.workDate)} ${viDate(r.workDate)}`}
                    {kind === "EDIT" && t?.shiftLabel ? ` · ${t.shiftLabel}` : ""}
                  </span>
                </p>
                <p className="text-xs text-ink/60">Gửi {viDateTime(r.createdAt)}</p>
                {kind === "EDIT" ? (
                  t ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[300px] overflow-hidden rounded-lg bg-white text-sm ring-1 ring-[#dbe6fb]">
                        <thead>
                          <tr className="bg-[#eaf1fe] text-left">
                            <th className="px-2 py-1.5 font-semibold"></th>
                            <th className="px-2 py-1.5 font-semibold">App đang ghi</th>
                            <th className="px-2 py-1.5 font-semibold">Nhân viên xin</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-[#e3ebfa]">
                            <td className="px-2 py-1.5 text-ink/70">Giờ vào</td>
                            <td className="px-2 py-1.5">{hm(t.checkInAt, t.storeId)}</td>
                            <td className={`px-2 py-1.5 font-bold ${hm(t.checkInAt, t.storeId) !== r.checkInTime ? "text-warn" : ""}`}>{r.checkInTime}</td>
                          </tr>
                          <tr className="border-t border-[#e3ebfa]">
                            <td className="px-2 py-1.5 text-ink/70">Giờ ra</td>
                            <td className="px-2 py-1.5">{t.checkOutAt ? hm(t.checkOutAt, t.storeId) : <Badge tone="red">Quên check-out</Badge>}</td>
                            <td className={`px-2 py-1.5 font-bold ${(t.checkOutAt ? hm(t.checkOutAt, t.storeId) : "") !== r.checkOutTime ? "text-warn" : ""}`}>{r.checkOutTime}</td>
                          </tr>
                          <tr className="border-t border-[#e3ebfa]">
                            <td className="px-2 py-1.5 text-ink/70">Giờ công</td>
                            <td className="px-2 py-1.5">{hoursShort(t.roundedHours ?? 0)}</td>
                            <td className="px-2 py-1.5 font-bold">{ctx.reqHours != null ? hoursShort(ctx.reqHours) : "—"}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="font-semibold text-danger">Lượt chấm công nhân viên xin sửa đã bị xoá – hãy Từ chối yêu cầu này.</p>
                  )
                ) : kind === "MISSING" ? (
                  <p>
                    Thêm lượt mới: vào <b>{r.checkInTime}</b> → ra <b>{r.checkOutTime}</b>
                    {ctx.reqHours != null && <b> = {hoursShort(ctx.reqHours)}</b>}
                    {ctx.shift ? ` · ${ctx.shift.a.shiftName} ${ctx.shift.a.startTime}–${ctx.shift.a.endTime}` : ""}
                  </p>
                ) : (
                  <p>
                    NV xin ngày {r.workDate && viDate(r.workDate)}: vào <b>{r.checkInTime || "--"}</b> · ra <b>{r.checkOutTime || "--"}</b>
                  </p>
                )}
                <p className="text-ink/70">Lý do: {r.reason}</p>
                <div className="space-y-0.5 text-xs">
                  {kind === "EDIT" && ctx.changedSince && r.before && (
                    <p className="font-semibold text-danger">
                      ⚠ Lượt này đã bị thay đổi sau khi nhân viên gửi (lúc gửi: vào {hm(r.before.checkInAt, r.storeId)} → ra {r.before.checkOutAt ? hm(r.before.checkOutAt, r.storeId) : "quên"}) – xem lại trước khi duyệt
                    </p>
                  )}
                  {kind === "MISSING" &&
                    (ctx.clash ? (
                      <p className="font-semibold text-danger">
                        ⚠ Trùng lượt đã có: {ctx.clash.shiftLabel ?? "Ngoài ca"} {attText(ctx.clash, ctx.tz)} – sửa giờ cho khỏi trùng hoặc Từ chối
                      </p>
                    ) : (
                      <p className="font-semibold text-secondary-dark">
                        {ctx.shift ? "Đúng ca được xếp" : "Không có ca được xếp → sau khi duyệt thành lượt ngoài ca (chờ xác nhận làm ngoài giờ)"} · không trùng lượt nào
                        {ctx.list.length ? ` (ngày này app đã có: ${ctx.list.map((a) => `${a.shiftLabel ?? "Ngoài ca"} ${attText(a, ctx.tz)}`).join("; ")})` : ""}
                      </p>
                    ))}
                  {!kind && <p className="font-semibold text-ink/70">App đang ghi ngày này: {ctx.list.length ? `${ctx.list.length} lượt` : "không có lượt nào"}</p>}
                  {ctx.warnings.map((w) => (
                    <p key={w} className="font-semibold text-warn">
                      ⚠ {w}
                    </p>
                  ))}
                </div>
                <Who storeId={r.storeId} perm={APPROVE_PERM.adjustment} />
                {canAdj && (
                <ApproveRejectForm action={resolveAdjustment} approveLabel={kind === "EDIT" ? "Duyệt – sửa lượt này" : kind === "MISSING" ? "Duyệt – thêm lượt" : "Duyệt & ghi nhận"}>
                  <input type="hidden" name="id" value={String(r._id)} />
                  {/* yêu cầu kiểu cũ: chọn lượt sẽ sửa (ngày làm 2 ca có nhiều lượt) – máy chọn sẵn theo giờ, admin đổi được */}
                  {(() => {
                    if (kind) return null;
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
                  <div className="flex flex-wrap items-center gap-2">
                    {kind && <span className="text-xs font-semibold text-ink/70">Admin chốt (sửa được):</span>}
                    <TimeInput name="inTime" defaultValue={r.checkInTime} className="flex-1" title="Giờ vào" required={!!kind} />
                    <TimeInput name="outTime" defaultValue={r.checkOutTime} className="flex-1" title="Giờ ra" required={!!kind} />
                  </div>
                </ApproveRejectForm>
                )}
              </div>
              );
            })}
          </div>
        )}
        {done.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-accent">Đã xử lý gần đây</summary>
            <ul className="mt-2 space-y-1">
              {done.map((r) => (
                <li key={String(r._id)}>
                  <Badge tone={r.status === "APPROVED" ? "green" : r.status === "CANCELLED" ? "gray" : "red"}>
                    {r.status === "APPROVED" ? "Duyệt" : r.status === "CANCELLED" ? "NV huỷ" : "Từ chối"}
                  </Badge>{" "}
                  {r.kind === "EDIT" ? "Sửa giờ · " : r.kind === "MISSING" ? "Chấm bù · " : ""}
                  {users.get(String(r.userId))} · {r.workDate && viDate(r.workDate)} · {r.checkInTime || "--"} → {r.checkOutTime || "--"}
                  {r.status !== "CANCELLED" && ` · ${r.adminName ?? ""}`} {r.adminReply && `– ${r.adminReply}`}
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
