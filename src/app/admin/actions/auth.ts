"use server";
import { track } from "@/lib/error-log";
import { redirect } from "next/navigation";
import { recordActivity } from "@/lib/activity-server";
import { adminActor, clearAdminCookie, getAdmin } from "@/lib/admin-session";
import { startAdminSession } from "@/lib/admin-enter";
import type { FormState } from "./types";

/* Admin đăng nhập bằng Gmail do Admin Tổng thêm ở mục Quản lý admin (không có đăng ký / yêu cầu). Không còn mật khẩu chung. */

/** Nút "Vào trang quản lý" (chỉ hiện sau khi admin tự thoát – bình thường vào tự động qua /api/admin/enter). */
async function adminEnter__(_: FormState): Promise<FormState> {
  const r = await startAdminSession();
  if (!r.ok) return { error: r.error };
  redirect("/admin");
}

async function adminLogout__() {
  const a = await getAdmin().catch(() => null);
  if (a?.kind === "ADMIN") await recordActivity(adminActor(a), "admin.logout");
  await clearAdminCookie();
  redirect("/admin/login?out=1");
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function adminEnter(...a: Parameters<typeof adminEnter__>) { return track("Admin › Đăng nhập", "adminEnter", () => adminEnter__(...a)); }
export async function adminLogout(...a: Parameters<typeof adminLogout__>) { return track("Admin › Đăng nhập", "adminLogout", () => adminLogout__(...a)); }
