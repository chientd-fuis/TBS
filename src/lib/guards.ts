import { redirect } from "next/navigation";
import { getAdmin, type AdminSession } from "./admin-session";
import { getSessionEmail, isOwnerEmail } from "./auth";
import { connectDB } from "./db";
import { User } from "./models";
import { ensureSeed } from "./settings";

export async function requireAdmin(): Promise<AdminSession> {
  await ensureSeed();
  const a = await getAdmin();
  if (!a) redirect("/admin/login");
  return a;
}

export async function requireOwner(): Promise<AdminSession> {
  const a = await requireAdmin();
  if (a.kind !== "OWNER") redirect("/admin?error=owner-only");
  return a;
}

/** Dùng trong server action: ném lỗi thay vì redirect. */
export async function assertAdmin(): Promise<AdminSession> {
  await ensureSeed();
  const a = await getAdmin();
  if (!a) throw new Error("Phiên admin đã hết hạn, vui lòng đăng nhập lại");
  return a;
}

/** Nhân viên đang đăng nhập (Google). */
export async function getCurrentUser() {
  const email = await getSessionEmail();
  if (!email) return null;
  await ensureSeed();
  await connectDB();
  return User.findOne({ email }).lean();
}

/** Trang nhân viên: bắt buộc đăng nhập + đã được duyệt. */
export async function requireActiveUser() {
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  if (isOwnerEmail(email)) redirect("/admin");
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.status === "NEW" || u.status === "REJECTED") redirect("/onboarding");
  if (u.status === "PENDING") redirect("/pending");
  if (u.status === "INACTIVE") redirect("/login?error=inactive");
  return u;
}
