"use server";
import { track } from "@/lib/error-log";
import { requireActiveUser } from "@/lib/guards";
import { markRemindersSeen } from "@/lib/reminders";

/** Nhân viên bấm "Đã hiểu" ở popup nhắc việc → không hiện popup nữa (vẫn nằm ở Bảng tin tới hết ca) */
async function markShiftRemindersSeen__(ids: string[]) {
  const user = await requireActiveUser();
  await markRemindersSeen(user._id, Array.isArray(ids) ? ids.map(String) : []);
  return { ok: true };
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function markShiftRemindersSeen(...a: Parameters<typeof markShiftRemindersSeen__>) { return track("Nhắc việc", "markShiftRemindersSeen", () => markShiftRemindersSeen__(...a)); }
