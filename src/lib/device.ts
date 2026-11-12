import { cookies, headers } from "next/headers";
import { Types } from "mongoose";
import { Device, LoginLog, User } from "./models";
import { getSettings } from "./settings";
import { isAdminEmail } from "./auth";

/* Ràng buộc thiết bị – spec 4.1.1 */

/**
 * Tài khoản admin (Admin Tổng / admin đang hoạt động, hoặc hồ sơ nhân viên tạo cho admin) vào app nhân viên
 * → KHÔNG cần admin duyệt thiết bị: thiết bị tự được duyệt, không tính giới hạn số thiết bị.
 */
async function isAdminUser(userId: Types.ObjectId) {
  const u = await User.findById(userId).select("email adminStaff").lean();
  return !!u && (!!u.adminStaff || (await isAdminEmail(u.email)));
}
const AUTO_BY = "Tự động – tài khoản admin";

export const DEVICE_COOKIE = "tbs_did";
const SESSION_MARK = "tbs_ll";

export type DeviceState =
  | { state: "APPROVED"; deviceId: string }
  | { state: "PENDING"; deviceId: string; reason: "NEW_DEVICE" | "FIRST_DEVICE"; requested?: boolean }
  | { state: "REVOKED" | "REJECTED"; deviceId: string }
  | { state: "OTHER_USER"; deviceId: string }
  | { state: "UNKNOWN" };

export function parseUA(ua: string) {
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "iOS"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac OS X/i.test(ua)
          ? "macOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Khác";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Khác";
  const model = ua.match(/Android [\d.]+; ([^;)]+)/)?.[1]?.trim() || (/iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : "");
  return { os, browser, model };
}

export async function clientInfo() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || "",
    userAgent: h.get("user-agent") || "",
  };
}

/** Lấy deviceId: ưu tiên cookie httpOnly, nếu mất cookie thì dùng id từ localStorage. */
export async function resolveDeviceId(localId?: string | null) {
  const c = (await cookies()).get(DEVICE_COOKIE)?.value;
  const id = c || (localId && /^[0-9a-f-]{36}$/i.test(localId) ? localId : "");
  return id;
}

export async function setDeviceCookie(id: string) {
  (await cookies()).set(DEVICE_COOKIE, id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 5 * 365 * 24 * 3600,
  });
}

/**
 * Gọi mỗi khi nhân viên mở app: ghi nhận thiết bị + login log.
 * - Thiết bị chưa có → tạo PENDING cho user này.
 * - Thiết bị thuộc user khác → OTHER_USER (chặn chấm công).
 */
export async function registerDevice(
  userId: Types.ObjectId,
  userStatus: string,
  deviceId: string,
  fingerprintHash: string,
): Promise<DeviceState> {
  if (!deviceId) return { state: "UNKNOWN" };
  const { ip, userAgent } = await clientInfo();
  const ua = parseUA(userAgent);
  const jar = await cookies();

  let dev = await Device.findOne({ deviceId });
  if (dev && String(dev.userId) !== String(userId)) {
    if (!jar.get(SESSION_MARK)) await LoginLog.create({ userId, deviceId, fingerprintHash, ip, userAgent });
    return { state: "OTHER_USER", deviceId };
  }
  const admin = await isAdminUser(userId); // admin → thiết bị tự duyệt
  if (!dev) {
    const old = fingerprintHash
      ? await Device.findOne({ userId, fingerprintHash, deviceId: { $ne: deviceId } }).select("deviceId").lean()
      : null;
    dev = await Device.create({
      deviceId,
      userId,
      fingerprintHash,
      userAgent,
      ...ua,
      status: admin ? "APPROVED" : "PENDING",
      ...(admin ? { approvedBy: AUTO_BY, approvedAt: new Date() } : {}),
      possibleOldDeviceId: old?.deviceId,
    });
  } else {
    dev.lastSeenAt = new Date();
    dev.userAgent = userAgent;
    if (fingerprintHash) dev.fingerprintHash = fingerprintHash;
    if (admin && dev.status !== "APPROVED") dev.set({ status: "APPROVED", approvedBy: AUTO_BY, approvedAt: new Date() });
    await dev.save();
  }
  await setDeviceCookie(deviceId);
  if (!jar.get(SESSION_MARK)) {
    await LoginLog.create({ userId, deviceId, fingerprintHash, ip, userAgent });
    jar.set(SESSION_MARK, "1", { httpOnly: true, sameSite: "lax", path: "/" }); // cookie phiên
  }
  if (dev.status === "APPROVED") return { state: "APPROVED", deviceId };
  if (dev.status === "PENDING")
    return { state: "PENDING", deviceId, reason: userStatus === "ACTIVE" ? "NEW_DEVICE" : "FIRST_DEVICE", requested: !!dev.requestedAt };
  return { state: dev.status as "REVOKED" | "REJECTED", deviceId };
}

/** Kiểm tra thiết bị khi chấm công. */
export async function checkDeviceForAttendance(userId: Types.ObjectId) {
  const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
  if (!deviceId) return { ok: false as const, error: "Không nhận diện được thiết bị. Vui lòng tải lại trang." };
  const dev = await Device.findOne({ deviceId }).lean();
  if (!dev) return { ok: false as const, error: "Thiết bị chưa được đăng ký." };
  if (String(dev.userId) !== String(userId))
    return { ok: false as const, error: "Thiết bị này đã gắn với nhân viên khác – không thể chấm công." };
  if (dev.status !== "APPROVED") {
    // tài khoản admin: không cần duyệt thiết bị → duyệt luôn
    if (await isAdminUser(userId)) {
      await Device.updateOne({ _id: dev._id }, { $set: { status: "APPROVED", approvedBy: AUTO_BY, approvedAt: new Date() } });
      return { ok: true as const, deviceId };
    }
    return { ok: false as const, error: "Thiết bị chưa được admin duyệt. Vui lòng gửi yêu cầu đổi thiết bị." };
  }
  return { ok: true as const, deviceId };
}

/** Duyệt thiết bị, đảm bảo không vượt số thiết bị tối đa (thu hồi thiết bị cũ nhất). */
export async function approveDevice(deviceRefId: string, adminName: string) {
  const settings = await getSettings();
  const dev = await Device.findById(deviceRefId);
  if (!dev) throw new Error("Không tìm thấy thiết bị");
  const approved = await Device.find({ userId: dev.userId, status: "APPROVED", _id: { $ne: dev._id } }).sort({
    approvedAt: 1,
  });
  const overflow = approved.length + 1 - settings.maxDevicesPerUser;
  for (let i = 0; i < overflow; i++) {
    approved[i].status = "REVOKED";
    await approved[i].save();
  }
  dev.status = "APPROVED";
  dev.approvedBy = adminName;
  dev.approvedAt = new Date();
  await dev.save();
  return dev;
}
