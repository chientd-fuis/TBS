"use server";
import { redirect } from "next/navigation";
import { connectDB } from "@/lib/db";
import { AdminAccount, AdminLoginLog } from "@/lib/models";
import { recordActivity } from "@/lib/activity-server";
import { getSettings } from "@/lib/settings";
import { clientInfo } from "@/lib/device";
import { getSessionEmail, isOwnerEmail } from "@/lib/auth";
import { adminActor, adminDeviceId, clearAdminCookie, createAdminCookie, getAdmin } from "@/lib/admin-session";
import type { FormState } from "./types";

/* Admin đăng nhập bằng Gmail (Admin Tổng thêm / duyệt ở mục Quản lý admin). Không còn mật khẩu chung. */

/** Gmail đã được duyệt → tạo phiên admin rồi vào trang quản lý. */
export async function adminEnter(_: FormState): Promise<FormState> {
  const email = await getSessionEmail();
  if (!email) return { error: "Chưa đăng nhập Google" };
  if (isOwnerEmail(email)) redirect("/admin");
  await connectDB();
  const { ip, userAgent } = await clientInfo();
  const acc = await AdminAccount.findOne({ email });
  if (!acc || acc.status !== "ACTIVE") {
    await AdminLoginLog.create({ kind: "GOOGLE", displayName: email, success: false, ip, userAgent }).catch(() => null);
    return { error: !acc ? "Gmail này chưa được Admin Tổng thêm làm admin" : acc.status === "BLOCKED" ? "Tài khoản admin này đã bị Admin Tổng khoá" : "Đang chờ Admin Tổng duyệt" };
  }
  const deviceId = await adminDeviceId();
  const now = new Date();
  // ghi lại thiết bị (chỉ để Admin Tổng xem)
  const dev = (acc.devices as { deviceId: string; ip?: string; userAgent?: string; lastSeenAt?: Date }[]).find((d) => d.deviceId === deviceId);
  if (dev) Object.assign(dev, { ip, userAgent, lastSeenAt: now });
  else acc.devices.push({ deviceId, ip, userAgent, status: "APPROVED", firstSeenAt: now, lastSeenAt: now, approvedAt: now });
  acc.lastLoginAt = now;
  acc.lastIp = ip;
  acc.lastUserAgent = userAgent;
  await acc.save();
  const s = await getSettings();
  const sid = await createAdminCookie(acc.name, s.adminSessionDays || 7, { ip, userAgent, accountId: String(acc._id), deviceId, email });
  await AdminLoginLog.create({ kind: "GOOGLE", displayName: email, success: true, ip, userAgent }).catch(() => null);
  await recordActivity({ kind: "ADMIN", name: acc.name, sid }, "admin.login", undefined, null, { ip });
  redirect("/admin");
}

/** Gmail chưa có trong danh sách admin → gửi yêu cầu cho Admin Tổng duyệt. */
export async function adminRequest(_: FormState, fd: FormData): Promise<FormState> {
  const email = await getSessionEmail();
  if (!email) return { error: "Chưa đăng nhập Google" };
  if (isOwnerEmail(email)) redirect("/admin");
  const name = String(fd.get("name") || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (name.length < 2) return { error: "Nhập tên hiển thị (VD: Lan – Văn Phú)" };
  await connectDB();
  if (await AdminAccount.exists({ email })) return { error: "Gmail này đã gửi yêu cầu – chờ Admin Tổng duyệt" };
  await AdminAccount.create({ email, name, status: "PENDING" });
  return { ok: true };
}

export async function adminLogout() {
  const a = await getAdmin().catch(() => null);
  if (a?.kind === "ADMIN") await recordActivity(adminActor(a), "admin.logout");
  await clearAdminCookie();
  redirect("/admin/login?out=1");
}
