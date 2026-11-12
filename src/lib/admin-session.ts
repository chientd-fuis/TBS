import { cache } from "react";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSessionEmail, isOwnerEmail } from "./auth";
import type { Actor } from "./audit";

/*
 * Đăng nhập trang quản lý:
 *  - Admin Tổng: Gmail OWNER_EMAIL.
 *  - Admin: Gmail được Admin Tổng thêm / duyệt (AdminAccount). Sau khi đăng nhập Google, bấm "Vào trang quản lý" → tạo PHIÊN admin
 *    (cookie tbs_admin, lưu DB) để Admin Tổng xem / đăng xuất từng phiên. Phiên chỉ hợp lệ khi đúng Gmail đang đăng nhập + tài khoản đang hoạt động.
 */
const COOKIE = "tbs_admin";
/** cookie thiết bị – chỉ để Admin Tổng xem admin đăng nhập từ những máy nào */
export const ADMIN_DEVICE_COOKIE = "tbs_admin_dev";

export async function adminDeviceId() {
  const jar = await cookies();
  let id = jar.get(ADMIN_DEVICE_COOKIE)?.value;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    id = randomUUID();
    jar.set(ADMIN_DEVICE_COOKIE, id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 400 * 86_400 });
  }
  return id;
}

function secret() {
  const s = process.env.ADMIN_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Thiếu ADMIN_JWT_SECRET");
  return new TextEncoder().encode(s);
}

export type AdminSession = {
  kind: "OWNER" | "ADMIN";
  name: string;
  email?: string;
  sid?: string;
  /** tài khoản admin (không có với Admin Tổng) */
  accountId?: string;
  /** quyền được Admin Tổng cấp (Admin Tổng: rỗng – luôn có mọi quyền, xem lib/permissions.ts can()) */
  perms: string[];
  /** cơ sở admin quản lý (rỗng / không có = mọi cơ sở) – dùng gửi đúng người xác nhận làm thêm giờ (lib/admin-stores.ts) */
  storeIds?: string[];
};

/** Tạo phiên admin (lưu DB để Admin Tổng xem / đăng xuất từng phiên) + cookie. */
export async function createAdminCookie(
  name: string,
  days: number,
  meta: { ip?: string; userAgent?: string; accountId: string; deviceId?: string; email: string },
) {
  const { connectDB } = await import("./db");
  const { AdminLoginSession } = await import("./models");
  await connectDB();
  const sid = randomUUID();
  await AdminLoginSession.create({
    sid,
    name,
    ip: meta.ip,
    userAgent: meta.userAgent,
    accountId: meta.accountId,
    deviceId: meta.deviceId,
    expiresAt: new Date(Date.now() + days * 86_400_000),
  });
  const token = await new SignJWT({ kind: "ADMIN", name, sid, aid: meta.accountId, email: meta.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${days}d`)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: days * 24 * 3600,
  });
  return sid;
}

/** Phiên admin trong DB (cache theo request). null = không có / đã bị đăng xuất / tài khoản bị khoá. */
const loadSession = cache(async (sid: string) => {
  const { connectDB } = await import("./db");
  const { AdminAccount, AdminLoginSession } = await import("./models");
  await connectDB();
  const s = await AdminLoginSession.findOne({ sid }).select("revokedAt lastSeenAt expiresAt accountId").lean();
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.accountId) return null;
  const acc = await AdminAccount.findById(s.accountId).select("email name status perms storeIds").lean();
  if (!acc || acc.status !== "ACTIVE") return null;
  // cập nhật "hoạt động lần cuối" tối đa 2 phút / lần
  if (!s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > 120_000) await AdminLoginSession.updateOne({ sid }, { $set: { lastSeenAt: new Date() } }).catch(() => null);
  return { ...s, account: acc };
});

/** Xoá cookie + đánh dấu phiên hiện tại đã đăng xuất. */
export async function clearAdminCookie(by = "Tự đăng xuất") {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      if (payload.sid) {
        const { AdminLoginSession } = await import("./models");
        await AdminLoginSession.updateOne({ sid: String(payload.sid), revokedAt: null }, { $set: { revokedAt: new Date(), revokedBy: by } });
      }
    } catch {
      /* token hỏng – chỉ cần xoá cookie */
    }
  }
  jar.delete(COOKIE);
}

/** Phiên quản lý hiện tại: Admin Tổng hoặc admin (Gmail được duyệt + phiên còn hiệu lực). */
export async function getAdmin(): Promise<AdminSession | null> {
  const email = await getSessionEmail();
  if (!email) return null;
  if (isOwnerEmail(email)) return { kind: "OWNER", name: "Admin Tổng", email, perms: [] };

  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const s = payload.sid ? await loadSession(String(payload.sid)) : null;
    // phiên phải thuộc đúng Gmail đang đăng nhập (đổi tài khoản Google → phải vào lại)
    if (!s || s.account.email !== email) return null;
    return {
      kind: "ADMIN",
      name: s.account.name,
      email,
      sid: String(payload.sid),
      accountId: String(s.account._id),
      perms: [...(s.account.perms ?? [])],
      storeIds: (s.account.storeIds ?? []).map(String),
    };
  } catch {
    return null;
  }
}

export function adminActor(a: AdminSession): Actor {
  return { kind: a.kind === "OWNER" ? "OWNER" : "ADMIN", name: a.kind === "OWNER" ? `Admin Tổng (${a.email})` : a.name, sid: a.sid };
}
