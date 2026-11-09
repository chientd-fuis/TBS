"use server";
import { redirect } from "next/navigation";
import { recordActivity } from "@/lib/activity-server";
import { adminActor, clearAdminCookie, getAdmin } from "@/lib/admin-session";
import { startAdminSession } from "@/lib/admin-enter";
import type { FormState } from "./types";

/* Admin đăng nhập bằng Gmail do Admin Tổng thêm ở mục Quản lý admin (không có đăng ký / yêu cầu). Không còn mật khẩu chung. */

/** Nút "Vào trang quản lý" (chỉ hiện sau khi admin tự thoát – bình thường vào tự động qua /api/admin/enter). */
export async function adminEnter(_: FormState): Promise<FormState> {
  const r = await startAdminSession();
  if (!r.ok) return { error: r.error };
  redirect("/admin");
}

export async function adminLogout() {
  const a = await getAdmin().catch(() => null);
  if (a?.kind === "ADMIN") await recordActivity(adminActor(a), "admin.logout");
  await clearAdminCookie();
  redirect("/admin/login?out=1");
}
