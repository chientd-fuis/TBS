"use server";
import { requireActiveUser } from "@/lib/guards";
import { markRemindersSeen } from "@/lib/reminders";

/** Nhân viên bấm "Đã hiểu" ở popup nhắc việc → không hiện popup nữa (vẫn nằm ở Bảng tin tới hết ca) */
export async function markShiftRemindersSeen(ids: string[]) {
  const user = await requireActiveUser();
  await markRemindersSeen(user._id, Array.isArray(ids) ? ids.map(String) : []);
  return { ok: true };
}
