import { connectDB } from "./db";
import { AdminAccount, AdminLoginLog } from "./models";
import { recordActivity } from "./activity-server";
import { getSettings } from "./settings";
import { clientInfo } from "./device";
import { getSessionEmail, isOwnerEmail } from "./auth";
import { adminDeviceId, createAdminCookie } from "./admin-session";

/**
 * Gmail đang đăng nhập là admin đang hoạt động → tạo phiên admin (cookie + DB), ghi thiết bị / lịch sử đăng nhập.
 * Dùng chung cho nút "Vào trang quản lý" và tự vào sau khi đăng nhập Google (/api/admin/enter).
 */
export async function startAdminSession(): Promise<{ ok: true; owner?: boolean } | { ok: false; error: string }> {
  const email = await getSessionEmail();
  if (!email) return { ok: false, error: "Chưa đăng nhập Google" };
  if (isOwnerEmail(email)) return { ok: true, owner: true };
  await connectDB();
  const { ip, userAgent } = await clientInfo();
  const acc = await AdminAccount.findOne({ email });
  if (!acc || acc.status !== "ACTIVE") {
    await AdminLoginLog.create({ kind: "GOOGLE", displayName: email, success: false, ip, userAgent }).catch(() => null);
    return { ok: false, error: !acc ? "Gmail này chưa được Admin Tổng thêm làm admin" : "Tài khoản admin này đã bị Admin Tổng khoá" };
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
  return { ok: true };
}
