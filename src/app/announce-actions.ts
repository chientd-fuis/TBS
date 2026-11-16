"use server";
import { getCurrentUser } from "@/lib/guards";
import { getAdmin } from "@/lib/admin-session";
import { markSeen } from "@/lib/announcements";

/** Đóng popup "Có gì mới" (Đã hiểu / Thử ngay / Bỏ qua / ✕) → ghi đã xem theo tài khoản, không hiện lại. */
export async function markAnnouncementsSeen(as: "user" | "admin", items: { id: string; version: number }[], action: string) {
  try {
    if (as === "admin") {
      const a = await getAdmin();
      if (!a?.email) return { error: "Hết phiên" };
      await markSeen(`admin:${a.email.toLowerCase()}`, items, action);
    } else {
      const u = await getCurrentUser();
      if (!u) return { error: "Chưa đăng nhập" };
      await markSeen(`user:${u._id}`, items, action);
    }
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
