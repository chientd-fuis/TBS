import { Types } from "mongoose";
import { APPROVED_SHIFT, ShiftAssignment, Store, User } from "./models";
import { addDays } from "./time";
import { slotInterval } from "./schedule";

/* Hỗ trợ cơ sở khác: nhân viên được xếp ca ở cơ sở không phải cơ sở gốc. */

type Id = string | Types.ObjectId;

/**
 * Tìm ca đã duyệt (ở BẤT KỲ cơ sở nào) của nhân viên trùng giờ với ca định xếp.
 * Trả về mô tả ca bị trùng, hoặc null.
 */
export async function findShiftClash(userId: Id, date: string, startTime: string, endTime: string, skip?: { tplId: string; date: string }) {
  const rows = await ShiftAssignment.find({ userId, date: { $gte: addDays(date, -1), $lte: addDays(date, 1) }, ...APPROVED_SHIFT })
    .select("storeId shiftTemplateId date startTime endTime shiftName")
    .lean();
  const days = [date];
  const [s, e] = slotInterval(days, date, { startTime, endTime });
  for (const r of rows) {
    if (!r.startTime || !r.endTime) continue;
    if (skip && String(r.shiftTemplateId) === skip.tplId && r.date === skip.date) continue;
    const [a, b] = slotInterval(days, r.date, { startTime: r.startTime, endTime: r.endTime });
    if (s < b && a < e) {
      const st = await Store.findById(r.storeId).select("name").lean();
      return `${r.shiftName ?? "ca"} ${r.startTime}–${r.endTime} ngày ${r.date.slice(8)}/${r.date.slice(5, 7)} tại ${st?.name ?? "?"}`;
    }
  }
  return null;
}

/** Ca đã duyệt của các nhân viên ở cơ sở KHÁC trong tuần (± 1 ngày cho ca qua đêm). */
export async function externalShifts(userIds: string[], days: string[], storeId: string) {
  if (!userIds.length) return [];
  const rows = await ShiftAssignment.find({
    userId: { $in: userIds },
    storeId: { $ne: new Types.ObjectId(storeId) },
    date: { $gte: addDays(days[0], -1), $lte: addDays(days[6], 1) },
    ...APPROVED_SHIFT,
  })
    .select("userId storeId date startTime endTime shiftName")
    .lean();
  const stores = new Map((await Store.find({ _id: { $in: rows.map((r) => r.storeId) } }).select("name").lean()).map((s) => [String(s._id), s.name]));
  return rows
    .filter((r) => r.startTime && r.endTime)
    .map((r) => ({
      userId: String(r.userId),
      date: r.date,
      startTime: r.startTime!,
      endTime: r.endTime!,
      shiftName: r.shiftName ?? "",
      storeName: stores.get(String(r.storeId)) ?? "?",
    }));
}

/** Nhân viên đang làm ở các cơ sở khác – để admin chọn gọi sang hỗ trợ. */
export async function otherStoreStaff(storeId: string) {
  const users = await User.find({ status: "ACTIVE", storeId: { $ne: new Types.ObjectId(storeId), $exists: true } })
    .select("name storeId")
    .sort({ name: 1 })
    .lean();
  const stores = new Map((await Store.find({ active: true }).select("name").lean()).map((s) => [String(s._id), s.name]));
  return users
    .filter((u) => stores.has(String(u.storeId)))
    .map((u) => ({ id: String(u._id), name: u.name || "?", storeName: stores.get(String(u.storeId))! }));
}

/**
 * Gắn nhãn hỗ trợ cho các lượt chấm công: "Hỗ trợ tại X" (đi hỗ trợ) hoặc "Hỗ trợ từ Y"
 * (khi đang xem bảng của chính cơ sở được hỗ trợ – viewStoreId).
 */
export async function labelSupport<T extends { storeId: unknown; homeStoreId?: unknown }>(rows: T[], viewStoreId?: string) {
  const ids = new Set<string>();
  for (const r of rows) {
    const home = String(r.homeStoreId ?? r.storeId);
    if (home !== String(r.storeId)) ids.add(home).add(String(r.storeId));
  }
  if (!ids.size) return rows.map((r) => ({ ...r, supportLabel: undefined as string | undefined }));
  const names = new Map((await Store.find({ _id: { $in: [...ids] } }).select("name").lean()).map((s) => [String(s._id), s.name]));
  return rows.map((r) => {
    const home = String(r.homeStoreId ?? r.storeId);
    const at = String(r.storeId);
    const supportLabel = home === at ? undefined : viewStoreId === at ? `Hỗ trợ từ ${names.get(home) ?? "?"}` : `Hỗ trợ tại ${names.get(at) ?? "?"}`;
    return { ...r, supportLabel };
  });
}
