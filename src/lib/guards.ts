import { redirect } from "next/navigation";
import { getAdmin, type AdminSession } from "./admin-session";
import { getSessionEmail, isOwnerEmail, userAppBlocked } from "./auth";
import { connectDB } from "./db";
import { User } from "./models";
import { ensureSeed } from "./settings";
import { can, canAny, type AdminPerm } from "./permissions";

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

/** Trang cần quyền (Admin Tổng luôn qua). Thiếu quyền → về Tổng quan. */
export async function requirePerm(...perms: AdminPerm[]): Promise<AdminSession> {
  const a = await requireAdmin();
  if (!canAny(a, perms)) redirect("/admin?error=forbidden");
  return a;
}

/** Server action / API cần quyền. */
export async function assertPerm(perm: AdminPerm): Promise<AdminSession> {
  const a = await assertAdmin();
  if (!can(a, perm)) throw new Error("Bạn chưa được Admin Tổng cấp quyền cho chức năng này");
  return a;
}

export async function assertOwner(): Promise<AdminSession> {
  const a = await assertAdmin();
  if (a.kind !== "OWNER") throw new Error("Chỉ Admin Tổng được làm thao tác này");
  return a;
}

/** Dùng trong server action: ném lỗi thay vì redirect. */
export async function assertAdmin(): Promise<AdminSession> {
  await ensureSeed();
  const a = await getAdmin();
  if (!a) throw new Error("Phiên admin đã hết hạn, vui lòng đăng nhập lại");
  return a;
}

/** Nhân viên đang đăng nhập (Google). Gmail admin chưa được phép vào app nhân viên (Cài đặt) → null. */
export async function getCurrentUser() {
  const email = await getSessionEmail();
  if (!email) return null;
  await ensureSeed();
  await connectDB();
  if (await userAppBlocked(email)) return null;
  return User.findOne({ email }).lean();
}

/** Trang nhân viên: bắt buộc đăng nhập + đã được duyệt. */
export async function requireActiveUser() {
  const email = await getSessionEmail();
  if (!email) redirect("/login");
  // Gmail admin chưa được phép vào app nhân viên → về trang quản lý (kể cả khi có hồ sơ nhân viên Full-time / part-time)
  if (await userAppBlocked(email)) redirect(isOwnerEmail(email) ? "/admin" : "/admin/login");
  const u = await getCurrentUser();
  if (!u) {
    // Gmail admin bị khoá / chờ duyệt (không phải nhân viên) → về trang quản lý thay vì vòng lặp /login ↔ /
    const { AdminAccount } = await import("./models");
    if (await AdminAccount.exists({ email })) redirect("/admin/login");
    redirect("/login");
  }
  if (u.status === "NEW" || u.status === "REJECTED") redirect("/onboarding");
  if (u.status === "PENDING") redirect("/pending");
  if (u.status === "INACTIVE") redirect("/login?error=inactive");
  return u;
}
