import { getAdmin, adminActor } from "./admin-session";
import { getCurrentUser } from "./guards";
import { managedStoreIds, staffCan, type StaffPerm } from "./permissions";
import type { Actor } from "./audit";

/**
 * Nhân viên được admin cấp quyền quản lý (xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ).
 * storeId có → phải thuộc cơ sở được giao (cơ sở gốc + cơ sở thêm). Actor gắn staff → thao tác ghi nhật ký ở Tổng quan cơ sở đó.
 */
export async function staffManager(perm: StaffPerm, storeId?: string) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") throw new Error("Phiên đăng nhập đã hết hạn");
  if (!staffCan(user, perm)) throw new Error("Bạn chưa được admin cấp quyền cho chức năng này");
  const stores = managedStoreIds(user);
  if (storeId && !stores.includes(String(storeId))) throw new Error("Bạn không được giao quản lý cơ sở này");
  const actor: Actor = {
    kind: "USER",
    name: user.name || user.email,
    staff: { userId: String(user._id), storeId: String(storeId ?? user.storeId) },
  };
  return { user, stores, actor };
}

/** Admin (ưu tiên) hoặc nhân viên có quyền ở cơ sở này. */
export async function adminOrStaff(perm: StaffPerm, storeId: string) {
  const admin = await getAdmin();
  if (admin) return { actor: adminActor(admin), admin, staff: null };
  const s = await staffManager(perm, storeId);
  return { actor: s.actor, admin: null, staff: s.user };
}

/** Trang Quản lý: thiếu quyền / sai cơ sở → về trang Quản lý (hoặc trang chủ). */
export async function requireStaff(perm: StaffPerm, storeId?: string) {
  const { redirect } = await import("next/navigation");
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") redirect("/login");
  if (!staffCan(user, perm)) redirect("/manage?error=forbidden");
  const stores = managedStoreIds(user);
  if (storeId && !stores.includes(String(storeId))) redirect("/manage?error=store");
  return { user, stores };
}
