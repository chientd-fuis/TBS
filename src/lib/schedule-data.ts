import { Types } from "mongoose";
import { connectDB } from "./db";
import { APPROVED_SHIFT, ShiftAssignment, ShiftTemplate, Store, User } from "./models";
import { addDays, weekDays } from "./time";
import { buildHistory, type Entry, type TplInfo } from "./schedule";

/** Dữ liệu lịch 1 tuần của 1 cơ sở (đã chuyển sang dạng thuần để truyền cho client). */
export async function loadWeek(storeId: string, weekStart: string) {
  await connectDB();
  const days = weekDays(weekStart);
  const store = await Store.findById(storeId).lean();
  if (!store) throw new Error("Không tìm thấy cơ sở");
  const rows = await ShiftAssignment.find({ storeId, date: { $gte: days[0], $lte: days[6] } }).lean();
  const tplDocs = await ShiftTemplate.find({ storeId, $or: [{ active: true }, { _id: { $in: rows.map((r) => r.shiftTemplateId) } }] })
    .sort({ startTime: 1 })
    .lean();
  const staffDocs = await User.find({ storeId, status: "ACTIVE" }).sort({ name: 1 }).select("name").lean();
  const extraIds = rows.map((r) => String(r.userId)).filter((id) => !staffDocs.some((s) => String(s._id) === id));
  const extra = extraIds.length ? await User.find({ _id: { $in: extraIds } }).select("name").lean() : [];

  const templates: TplInfo[] = tplDocs.map((t) => ({
    id: String(t._id),
    name: t.name,
    startTime: t.startTime,
    endTime: t.endTime,
    minStaff: t.minStaff ?? 0,
    targetStaff: t.targetStaff ?? 0,
  }));
  const entries: Entry[] = rows.map((r) => ({
    id: String(r._id),
    userId: String(r.userId),
    tplId: String(r.shiftTemplateId),
    date: r.date,
    status: (r.status ?? "APPROVED") as Entry["status"],
    source: r.source ?? "MANUAL",
    createdAt: r.createdAt ? new Date(r.createdAt).getTime() : 0,
  }));
  const staff = staffDocs.map((u) => ({ id: String(u._id), name: u.name || "?" }));
  const names: Record<string, string> = Object.fromEntries([...staffDocs, ...extra].map((u) => [String(u._id), u.name || "?"]));
  return { store: { id: String(store._id), name: store.name, timezone: store.timezone || "Asia/Ho_Chi_Minh" }, days, templates, entries, staff, names };
}

/** Lịch sử 8 tuần trước (ca đã duyệt) – dùng cho ưu tiên "hay làm ca này / hay làm cùng nhau". */
export async function loadHistory(storeId: string, weekStart: string) {
  const rows = await ShiftAssignment.find({
    storeId: new Types.ObjectId(storeId),
    date: { $gte: addDays(weekStart, -56), $lt: weekStart },
    ...APPROVED_SHIFT,
  })
    .select("userId shiftTemplateId date")
    .lean();
  return buildHistory(rows.map((r) => ({ userId: String(r.userId), tplId: String(r.shiftTemplateId), date: r.date })));
}
