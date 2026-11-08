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
  if (await CoverRequest.exists({ shiftAssignmentId: sa._id, status: "PENDING" })) throw new Error("Ca này đang có yêu cầu nhờ làm hộ chờ duyệt");
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

/** Admin duyệt: chuyển ca từ NV1 sang NV2, báo cho cả 2. */
export async function approveCover(id: string, by: string, reply?: string) {
  await connectDB();
  const r = await CoverRequest.findById(id);
  if (!r || r.status !== "PENDING") throw new Error("Yêu cầu đã được xử lý");
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
  await notifyUser(r.fromUserId, `Yêu cầu nhờ ${to?.name ?? "?"} làm hộ ${shiftText(r)} bị từ chối${reply ? `: ${reply}` : ""}. Bạn vẫn làm ca này.`, "orange", "/schedule");
  return r;
}
