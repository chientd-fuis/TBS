"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { AdminLoginLog, Settings } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { clientInfo } from "@/lib/device";
import { adminActor, clearAdminCookie, createAdminCookie } from "@/lib/admin-session";
import { assertAdmin } from "@/lib/guards";
import { audit } from "@/lib/audit";
import type { FormState } from "./types";

const MAX_FAILS = 5;
const LOCK_MIN = 15;

/** Đăng nhập site admin bằng mật khẩu chung (spec 2.1). */
export async function adminLogin(_: FormState, fd: FormData): Promise<FormState> {
  await connectDB();
  const password = String(fd.get("password") || "");
  const displayName = String(fd.get("displayName") || "").trim().slice(0, 60);
  const { ip, userAgent } = await clientInfo();
  const since = new Date(Date.now() - LOCK_MIN * 60000);
  const fails = await AdminLoginLog.countDocuments({ kind: "PASSWORD", success: false, ip, createdAt: { $gte: since } });
  if (fails >= MAX_FAILS) return { error: `Sai mật khẩu quá ${MAX_FAILS} lần. Thử lại sau ${LOCK_MIN} phút.` };
  if (displayName.length < 2) return { error: "Nhập tên hiển thị của bạn (để ghi lịch sử thao tác)" };

  const s = await getSettings();
  if (!s.adminPasswordHash) return { error: "Chưa đặt mật khẩu admin. Chủ cần đăng nhập bằng Google để đặt mật khẩu." };
  const ok = await bcrypt.compare(password, s.adminPasswordHash);
  await AdminLoginLog.create({ kind: "PASSWORD", displayName, success: ok, ip, userAgent });
  if (!ok) return { error: `Mật khẩu không đúng (còn ${MAX_FAILS - fails - 1} lần thử)` };
  await createAdminCookie(displayName, s.adminSessionVersion, s.adminSessionDays || 7);
  redirect("/admin");
}

export async function adminLogout() {
  await clearAdminCookie();
  redirect("/admin/login");
}

function validatePassword(p: string) {
  if (p.length < 8) return "Mật khẩu tối thiểu 8 ký tự";
  if (!/[a-zA-Z]/.test(p) || !/\d/.test(p)) return "Mật khẩu phải có cả chữ và số";
  return null;
}

/**
 * Đổi mật khẩu: admin nhập mật khẩu hiện tại; Chủ có thể đặt lại không cần mật khẩu cũ.
 * Sau khi đổi: tăng adminSessionVersion → tất cả phiên admin dùng mật khẩu cũ bị đăng xuất.
 */
export async function changeAdminPassword(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await assertAdmin();
  const current = String(fd.get("current") || "");
  const next = String(fd.get("next") || "");
  const confirm = String(fd.get("confirm") || "");
  const s = await getSettings();
  if (admin.kind !== "OWNER" || (s.adminPasswordHash && current)) {
    if (!s.adminPasswordHash || !(await bcrypt.compare(current, s.adminPasswordHash)))
      return { error: "Mật khẩu hiện tại không đúng" };
  }
  const err = validatePassword(next);
  if (err) return { error: err };
  if (next !== confirm) return { error: "Nhập lại mật khẩu mới không khớp" };
  const { ip } = await clientInfo();
  await Settings.updateOne(
    { key: "main" },
    { $set: { adminPasswordHash: await bcrypt.hash(next, 10), adminPasswordChangedAt: new Date() }, $inc: { adminSessionVersion: 1 } },
  );
  await audit(adminActor(admin), "admin.password.change", { type: "Settings" }, null, { ip });
  // phiên hiện tại (nếu là admin mật khẩu) cũng cần đăng nhập lại
  if (admin.kind === "PASSWORD") {
    await clearAdminCookie();
    redirect("/admin/login?changed=1");
  }
  revalidatePath("/admin/settings");
  return { ok: true };
}
