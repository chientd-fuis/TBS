import { Types } from "mongoose";
import { Attendance, Store } from "./models";
import { findShiftForClosing } from "./attendance";
import { localDate } from "./time";

/**
 * Ngữ cảnh 1 lượt chốt ca của nhân viên: lượt chấm công gắn kèm, ca đang chốt (có thể là ca hỗ trợ),
 * cơ sở đang làm (lượt chấm công → ca → cơ sở gốc), ngày làm việc.
 */
export async function resolveClosingContext(user: { _id: Types.ObjectId; storeId?: Types.ObjectId | null }, now = new Date()) {
  const home = await Store.findById(user.storeId).lean();
  if (!home) return null;
  const homeTz = home.timezone || "Asia/Ho_Chi_Minh";
  const homeToday = localDate(now, homeTz);
  const att =
    (await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean()) ??
    (await Attendance.findOne({ userId: user._id, workDate: homeToday }).sort({ checkInAt: -1 }).lean());
  const shift = await findShiftForClosing(user._id, now, homeTz, att?.shiftAssignmentId);
  const storeId = att?.storeId ?? shift?.storeId ?? home._id;
  const store = String(storeId) === String(home._id) ? home : ((await Store.findById(storeId).lean()) ?? home);
  const tz = store.timezone || homeTz;
  const today = localDate(now, tz);
  return { home, store, tz, today, att, shift, workDate: shift?.date ?? today };
}
