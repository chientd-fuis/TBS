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

export type AdminSession = { kind: "OWNER" | "PASSWORD"; name: string; email?: string };

export async function createAdminCookie(name: string, sessionVersion: number, days: number) {
  const token = await new SignJWT({ kind: "PASSWORD", name, sv: sessionVersion })
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
}

export async function clearAdminCookie() {
  (await cookies()).delete(COOKIE);
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
    return { kind: "PASSWORD", name: String(payload.name || "Admin") };
  } catch {
    return null;
  }
}

export function adminActor(a: AdminSession): Actor {
  return { kind: a.kind === "OWNER" ? "OWNER" : "ADMIN", name: a.kind === "OWNER" ? `Chủ (${a.email})` : a.name };
}
