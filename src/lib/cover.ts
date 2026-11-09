import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, CoverRequest, ShiftAssignment, Store, User, UserNotice } from "./models";
import { findShiftClash } from "./support";

/* Nhờ làm hộ ca */

type Id = string | Types.ObjectId;
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
export const shiftText = (r: { shiftName?: string | null; startTime?: string | null; endTime?: string | null; date: string }) =>
  `ca ${r.shiftName ?? ""} ${r.startTime ?? ""}–${r.endTime ?? ""} ngày ${dm(r.date)}`.replace(/\s+/g, " ");

export async function notifyUser(userId: Id, text: string, tone: "green" | "orange" | "red" | "blue" = "blue", link?: string) {
  await UserNotice.create({ userId, text, tone, link });
}

/** NV gửi yêu cầu nhờ người khác làm hộ 1 ca đã duyệt của mình. */
export async function createCoverRequest(fromUserId: Id, shiftAssignmentId: string, toUserId: string, note: string, today: string) {
  await connectDB();
  const sa = await ShiftAssignment.findOne({ _id: shiftAssignmentId, userId: fromUserId, ...APPROVED_SHIFT }).lean();
  if (!sa) throw new Error("Không tìm thấy ca đã duyệt của bạn");
  if (sa.date < today) throw new Error("Ca đã qua, không nhờ làm hộ được");
  if (String(toUserId) === String(fromUserId)) throw new Error("Chọn người khác");
  const to = await User.findOne({ _id: toUserId, status: "ACTIVE" }).select("name").lean();
  if (!to) throw new Error("Người được nhờ không hợp lệ");
  if (await shiftBusy(sa._id)) throw new Error("Ca này đang có yêu cầu nhờ làm hộ / đổi ca chờ duyệt");
  const clash = await findShiftClash(to._id, sa.date, sa.startTime!, sa.endTime!);
  if (clash) throw new Error(`${to.name} đã có ${clash} – trùng giờ`);
  return CoverRequest.create({
    fromUserId,
    toUserId: to._id,
    shiftAssignmentId: sa._id,
    storeId: sa.storeId,
    date: sa.date,
    shiftName: sa.shiftName,
    startTime: sa.startTime,
    endTime: sa.endTime,
    note: note.slice(0, 300) || undefined,
  });
}

/** Ca đang nằm trong 1 yêu cầu chờ duyệt (nhờ làm hộ hoặc đổi ca, ở bất kỳ phía nào). */
const shiftBusy = (saId: Id) =>
  CoverRequest.exists({ status: "PENDING", $or: [{ shiftAssignmentId: saId }, { toShiftAssignmentId: saId }] });

const isApproved = (sa: { status?: string | null }) => !sa.status || sa.status === "APPROVED";

/**
 * NV1 xin đổi 1 ca đã duyệt của mình lấy 1 ca đã duyệt của NV2 (VD ca Sáng T2 ↔ ca Tối T3).
 * Cả 2 ca phải đã được duyệt, chưa qua, không trùng giờ sau khi đổi → gửi admin duyệt.
 */
export async function createSwapRequest(fromUserId: Id, myShiftId: string, theirShiftId: string, note: string, today: string) {
  await connectDB();
  if (!Types.ObjectId.isValid(myShiftId)) throw new Error("Chọn ca của bạn muốn đổi");
  if (!Types.ObjectId.isValid(theirShiftId)) throw new Error("Chọn ca của người muốn đổi");
  const [a, b] = await Promise.all([ShiftAssignment.findById(myShiftId).lean(), ShiftAssignment.findById(theirShiftId).lean()]);
  if (!a || String(a.userId) !== String(fromUserId)) throw new Error("Không tìm thấy ca của bạn");
  if (!isApproved(a)) throw new Error("Ca của bạn chưa được duyệt – chỉ đổi được ca đã duyệt");
  if (!b) throw new Error("Không tìm thấy ca của người muốn đổi");
  if (String(b.userId) === String(fromUserId)) throw new Error("Chọn ca của người khác");
  const to = await User.findOne({ _id: b.userId, status: "ACTIVE" }).select("name").lean();
  if (!to) throw new Error("Người muốn đổi không còn làm việc");
  if (!isApproved(b)) throw new Error(`Ca của ${to.name} chưa được duyệt – chỉ đổi được khi cả 2 đều có ca đã duyệt`);
  if (a.date < today || b.date < today) throw new Error("Ca đã qua, không đổi được");
  if (a.date === b.date && String(a.shiftTemplateId) === String(b.shiftTemplateId)) throw new Error("2 ca giống nhau – không cần đổi");
  if (await shiftBusy(a._id)) throw new Error("Ca của bạn đang có yêu cầu nhờ làm hộ / đổi ca chờ duyệt");
  if (await shiftBusy(b._id)) throw new Error(`Ca của ${to.name} đang có yêu cầu nhờ làm hộ / đổi ca khác chờ duyệt`);
  await assertSwapFits(a, b, to.name ?? "Người kia");
  const r = await CoverRequest.create({
    kind: "SWAP",
    fromUserId,
    toUserId: b.userId,
    shiftAssignmentId: a._id,
    storeId: a.storeId,
    date: a.date,
    shiftName: a.shiftName,
    startTime: a.startTime,
    endTime: a.endTime,
    toShiftAssignmentId: b._id,
    toStoreId: b.storeId,
    toDate: b.date,
    toShiftName: b.shiftName,
    toStartTime: b.startTime,
    toEndTime: b.endTime,
    note: note.slice(0, 300) || undefined,
  });
  const from = await User.findById(fromUserId).select("name").lean();
  await notifyUser(b.userId, `${from?.name ?? "Đồng nghiệp"} xin đổi ${shiftText(a)} của họ lấy ${shiftText(b)} của bạn – đang chờ admin duyệt.`, "blue", "/schedule");
  return r;
}

type SwapShift = { userId: unknown; shiftTemplateId: unknown; date: string; startTime?: string | null; endTime?: string | null };
/** Sau khi đổi: NV1 làm ca b (bỏ ca a), NV2 làm ca a (bỏ ca b) – không được trùng giờ ca khác. */
async function assertSwapFits(a: SwapShift, b: SwapShift, toName: string, fromName = "Bạn") {
  const c1 = await findShiftClash(a.userId as Id, b.date, b.startTime!, b.endTime!, { tplId: String(a.shiftTemplateId), date: a.date });
  if (c1) throw new Error(`${fromName} đã có ${c1} – trùng giờ với ca nhận về`);
  const c2 = await findShiftClash(b.userId as Id, a.date, a.startTime!, a.endTime!, { tplId: String(b.shiftTemplateId), date: b.date });
  if (c2) throw new Error(`${toName} đã có ${c2} – trùng giờ với ca nhận về`);
}

/** Admin duyệt đổi ca: hoán đổi người của 2 ca → lịch làm việc cập nhật, báo cho cả 2. */
async function approveSwap(r: InstanceType<typeof CoverRequest>, by: string, reply?: string) {
  const [a, b] = await Promise.all([ShiftAssignment.findById(r.shiftAssignmentId), ShiftAssignment.findById(r.toShiftAssignmentId)]);
  const ok = a && b && String(a.userId) === String(r.fromUserId) && String(b.userId) === String(r.toUserId) && isApproved(a) && isApproved(b);
  if (!ok) {
    r.set({ status: "CANCELLED", decidedBy: by, decidedAt: new Date(), reply: "1 trong 2 ca đã thay đổi" });
    await r.save();
    throw new Error("1 trong 2 ca đã thay đổi (bị xoá / chuyển người / chưa duyệt) – yêu cầu đã huỷ");
  }
  const [from, to] = await Promise.all([User.findById(r.fromUserId).select("name").lean(), User.findById(r.toUserId).select("name").lean()]);
  await assertSwapFits(a, b, to?.name ?? "Người nhận đổi", from?.name ?? "Người xin đổi");
  const meta = { source: "MANUAL" as const, decidedBy: by, decidedAt: new Date() };
  a.set({ userId: r.toUserId, ...meta });
  await a.save();
  try {
    b.set({ userId: r.fromUserId, ...meta });
    await b.save();
  } catch (e) {
    a.set({ userId: r.fromUserId }); // hoàn tác ca thứ nhất
    await a.save();
    throw e;
  }
  r.set({ status: "APPROVED", decidedBy: by, decidedAt: new Date(), reply: reply || undefined });
  await r.save();
  const sa = { date: r.date, shiftName: r.shiftName, startTime: r.startTime, endTime: r.endTime };
  const sb = { date: r.toDate!, shiftName: r.toShiftName, startTime: r.toStartTime, endTime: r.toEndTime };
  const note = reply ? ` Ghi chú: ${reply}` : "";
  await notifyUser(r.fromUserId, `Đổi ca với ${to?.name ?? "?"} đã được duyệt: bạn làm ${shiftText(sb)}, không làm ${shiftText(sa)} nữa.${note}`, "green", "/schedule");
  await notifyUser(r.toUserId, `Đổi ca với ${from?.name ?? "?"} đã được duyệt: bạn làm ${shiftText(sa)}, không làm ${shiftText(sb)} nữa.${note}`, "green", "/schedule");
  return r;
}

/** Admin duyệt: chuyển ca từ NV1 sang NV2 (nhờ làm hộ) hoặc hoán đổi 2 ca (đổi ca), báo cho cả 2. */
export async function approveCover(id: string, by: string, reply?: string) {
  await connectDB();
  const r = await CoverRequest.findById(id);
  if (!r || r.status !== "PENDING") throw new Error("Yêu cầu đã được xử lý");
  if (r.kind === "SWAP") return approveSwap(r, by, reply);
  const sa = await ShiftAssignment.findById(r.shiftAssignmentId);
  if (!sa || String(sa.userId) !== String(r.fromUserId) || (sa.status && sa.status !== "APPROVED")) {
    r.set({ status: "CANCELLED", decidedBy: by, decidedAt: new Date(), reply: "Ca không còn của người nhờ" });
    await r.save();
    throw new Error("Ca này đã thay đổi (bị xoá / chuyển người) – yêu cầu đã huỷ");
  }
  const clash = await findShiftClash(r.toUserId, sa.date, sa.startTime!, sa.endTime!);
  if (clash) throw new Error(`Người làm hộ đã có ${clash} – trùng giờ`);
  sa.set({ userId: r.toUserId, source: "MANUAL", decidedBy: by, decidedAt: new Date() });
  await sa.save();
  r.set({ status: "APPROVED", decidedBy: by, decidedAt: new Date(), reply: reply || undefined });
  await r.save();
  const [from, to, store] = await Promise.all([
    User.findById(r.fromUserId).select("name").lean(),
    User.findById(r.toUserId).select("name").lean(),
    Store.findById(r.storeId).select("name").lean(),
  ]);
  const what = `${shiftText(r)} tại ${store?.name ?? ""}`;
  await notifyUser(r.toUserId, `Bạn được nhờ làm hộ ${what} (thay ${from?.name ?? "?"}) – admin đã duyệt, ca đã vào lịch của bạn.${reply ? ` Ghi chú: ${reply}` : ""}`, "green", "/schedule");
  await notifyUser(r.fromUserId, `Yêu cầu nhờ ${to?.name ?? "?"} làm hộ ${what} đã được duyệt – ca đã chuyển sang ${to?.name ?? "người làm hộ"}.`, "green", "/schedule");
  return r;
}

export async function rejectCover(id: string, by: string, reply?: string) {
  await connectDB();
  const r = await CoverRequest.findById(id);
  if (!r || r.status !== "PENDING") throw new Error("Yêu cầu đã được xử lý");
  r.set({ status: "REJECTED", decidedBy: by, decidedAt: new Date(), reply: reply || undefined });
  await r.save();
  const to = await User.findById(r.toUserId).select("name").lean();
  if (r.kind === "SWAP") {
    const sb = { date: r.toDate!, shiftName: r.toShiftName, startTime: r.toStartTime, endTime: r.toEndTime };
    const from = await User.findById(r.fromUserId).select("name").lean();
    const why = reply ? `: ${reply}` : "";
    await notifyUser(r.fromUserId, `Yêu cầu đổi ${shiftText(r)} lấy ${shiftText(sb)} của ${to?.name ?? "?"} bị từ chối${why}. Lịch giữ nguyên.`, "orange", "/schedule");
    await notifyUser(r.toUserId, `Yêu cầu đổi ca của ${from?.name ?? "?"} (lấy ${shiftText(sb)} của bạn) bị từ chối – bạn vẫn làm ca của mình.`, "orange", "/schedule");
    return r;
  }
  await notifyUser(r.fromUserId, `Yêu cầu nhờ ${to?.name ?? "?"} làm hộ ${shiftText(r)} bị từ chối${reply ? `: ${reply}` : ""}. Bạn vẫn làm ca này.`, "orange", "/schedule");
  return r;
}
