import { cache } from "react";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSessionEmail, isOwnerEmail } from "./auth";
import { getSettings } from "./settings";
import type { Actor } from "./audit";

const COOKIE = "tbs_admin";

function secret() {
  const s = process.env.ADMIN_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("Thiếu ADMIN_JWT_SECRET");
  return new TextEncoder().encode(s);
}

export type AdminSession = { kind: "OWNER" | "PASSWORD"; name: string; email?: string; sid?: string };

/** Tạo phiên (lưu DB để Chủ xem / đăng xuất từng phiên) + cookie. */
export async function createAdminCookie(name: string, sessionVersion: number, days: number, meta: { ip?: string; userAgent?: string } = {}) {
  const { connectDB } = await import("./db");
  const { AdminLoginSession } = await import("./models");
  await connectDB();
  const sid = randomUUID();
  await AdminLoginSession.create({ sid, name, ip: meta.ip, userAgent: meta.userAgent, expiresAt: new Date(Date.now() + days * 86_400_000) });
  const token = await new SignJWT({ kind: "PASSWORD", name, sv: sessionVersion, sid })
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

/** Phiên admin trong DB (cache theo request). null = không có / đã bị đăng xuất. */
const loadSession = cache(async (sid: string) => {
  const { connectDB } = await import("./db");
  const { AdminLoginSession } = await import("./models");
  await connectDB();
  const s = await AdminLoginSession.findOne({ sid }).select("revokedAt lastSeenAt expiresAt").lean();
  if (!s || s.revokedAt || s.expiresAt < new Date()) return null;
  // cập nhật "hoạt động lần cuối" tối đa 2 phút / lần
  if (!s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > 120_000) await AdminLoginSession.updateOne({ sid }, { $set: { lastSeenAt: new Date() } }).catch(() => null);
  return s;
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

/** Phiên admin hiện tại: Chủ (Google) hoặc admin dùng mật khẩu chung. */
export async function getAdmin(): Promise<AdminSession | null> {
  const email = await getSessionEmail();
  if (isOwnerEmail(email)) return { kind: "OWNER", name: "Chủ", email: email! };

  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const settings = await getSettings();
    // Đổi mật khẩu → tăng adminSessionVersion → mọi phiên cũ hết hiệu lực
    if (payload.sv !== settings.adminSessionVersion) return null;
    // mỗi lần đăng nhập là 1 phiên trong DB – Chủ đăng xuất phiên → token vô hiệu ngay
    if (!payload.sid || !(await loadSession(String(payload.sid)))) return null;
    return { kind: "PASSWORD", name: String(payload.name || "Admin"), sid: String(payload.sid) };
  } catch {
    return null;
  }
}

export function adminActor(a: AdminSession): Actor {
  return { kind: a.kind === "OWNER" ? "OWNER" : "ADMIN", name: a.kind === "OWNER" ? `Chủ (${a.email})` : a.name, sid: a.sid };
}
