import { connectDB } from "./db";
import { AdminActivity, Attendance, CoverRequest, Device, ShiftAssignment, ShiftClosing, ShiftTemplate, Store, User } from "./models";
import { actionMeta, describe, refsOf, type Names } from "./activity";
import type { Actor } from "./audit";

type Data = Record<string, unknown>;
const plain = (x: unknown): Data => {
  if (!x || typeof x !== "object") return {};
  const o = x as { toObject?: () => Data };
  return typeof o.toObject === "function" ? o.toObject() : (x as Data);
};

/** Bổ sung thông tin còn thiếu (nhân viên, cơ sở, ngày) từ bản ghi đích. */
async function enrich(target: { type: string; id?: string } | undefined, d: Data): Promise<Data> {
  if (!target?.id) return d;
  const id = target.id;
  const q = <T,>(p: Promise<T>) => p.catch(() => null);
  switch (target.type) {
    case "User":
      return { userId: id, ...d };
    case "Store":
      return { storeId: id, ...d };
    case "Attendance": {
      if (d.userId && d.checkInAt) return d;
      const a = await q(Attendance.findById(id).select("userId storeId checkInAt checkOutAt").lean());
      return a ? { userId: a.userId, storeId: a.storeId, checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, ...d } : d;
    }
    case "ShiftClosing": {
      const c = await q(ShiftClosing.findById(id).select("storeId workDate shiftName").lean());
      return c ? { storeId: c.storeId, workDate: c.workDate, shiftName: c.shiftName, ...d } : d;
    }
    case "CoverRequest": {
      const c = await q(CoverRequest.findById(id).select("fromUserId toUserId date shiftName").lean());
      return c ? { fromUserId: c.fromUserId, toUserId: c.toUserId, date: c.date, shiftName: c.shiftName, ...d } : d;
    }
    case "ShiftAssignment": {
      if (d.userId) return d;
      const s = await q(ShiftAssignment.findById(id).select("userId date shiftName storeId").lean());
      return s ? { userId: s.userId, date: s.date, shiftName: s.shiftName, storeId: s.storeId, ...d } : d;
    }
    case "ShiftTemplate": {
      const t = await q(ShiftTemplate.findById(id).select("name storeId").lean());
      return t ? { shiftName: t.name, storeId: t.storeId, ...d } : d;
    }
    case "Device": {
      if (d.userId) return d;
      const v = await q(Device.findById(id).select("userId").lean());
      return v ? { userId: v.userId, ...d } : d;
    }
  }
  return d;
}

/** Câu mô tả + cơ sở liên quan của 1 thao tác (dùng chung cho lịch sử admin & nhật ký nhân viên quản lý). */
async function summarize(action: string, target?: { type: string; id?: string }, before?: unknown, after?: unknown) {
  await connectDB();
  const d = await enrich(target, { ...plain(before), ...plain(after) });
  const refs = refsOf(d);
  const [users, stores] = await Promise.all([
    refs.users.size ? User.find({ _id: { $in: [...refs.users] } }).select("name").lean().catch(() => []) : [],
    refs.stores.size ? Store.find({ _id: { $in: [...refs.stores] } }).select("name").lean().catch(() => []) : [],
  ]);
  const names: Names = {
    users: new Map(users.map((u) => [String(u._id), u.name || "?"])),
    stores: new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")])),
  };
  const storeId = d.storeId && /^[a-f0-9]{24}$/i.test(String(d.storeId)) ? String(d.storeId) : undefined;
  return { summary: describe(action, d, names), storeId };
}

/** Nhân viên được cấp quyền quản lý thao tác → ghi nhật ký cho admin cơ sở đó (hiện ở Tổng quan). Không bao giờ throw. */
export async function recordStaffActivity(
  actor: { name: string; userId?: string; storeId?: string },
  action: string,
  target?: { type: string; id?: string },
  before?: unknown,
  after?: unknown,
) {
  try {
    const { StaffActivity } = await import("./models");
    const { summary, storeId } = await summarize(action, target, before, after);
    await StaffActivity.create({ storeId: actor.storeId ?? storeId, userId: actor.userId, userName: actor.name, action, summary: [actionMeta(action).label, summary].filter(Boolean).join(" · ") });
  } catch (e) {
    console.error("recordStaffActivity failed", e);
  }
}

/** Ghi 1 dòng lịch sử hoạt động cho admin (Chủ không ghi). Không bao giờ throw. */
export async function recordActivity(actor: Actor, action: string, target?: { type: string; id?: string }, before?: unknown, after?: unknown) {
  if (actor.kind !== "ADMIN") return;
  try {
    await connectDB();
    const d = await enrich(target, { ...plain(before), ...plain(after) });
    const refs = refsOf(d);
    const [users, stores] = await Promise.all([
      refs.users.size ? User.find({ _id: { $in: [...refs.users] } }).select("name").lean().catch(() => []) : [],
      refs.stores.size ? Store.find({ _id: { $in: [...refs.stores] } }).select("name").lean().catch(() => []) : [],
    ]);
    const names: Names = {
      users: new Map(users.map((u) => [String(u._id), u.name || "?"])),
      stores: new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")])),
    };
    await AdminActivity.create({
      sid: actor.sid,
      adminName: actor.name,
      action,
      targetType: target?.type,
      targetId: target?.id,
      summary: describe(action, d, names),
      storeId: d.storeId && /^[a-f0-9]{24}$/i.test(String(d.storeId)) ? String(d.storeId) : undefined,
    });
  } catch (e) {
    console.error("recordActivity failed", e);
  }
}
