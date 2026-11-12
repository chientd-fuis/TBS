import { connectDB } from "./db";
import { AdminAccount } from "./models";
import type { AdminSession } from "./admin-session";

/*
 * Cơ sở admin quản lý (AdminAccount.storeIds – chọn ở Quản lý admin, được nhiều cơ sở).
 * Rỗng = quản lý mọi cơ sở (giống trước khi có chức năng này). Admin Tổng luôn mọi cơ sở.
 * Hiện dùng để GẮN TÊN người chịu trách nhiệm xác nhận (làm thêm giờ, đổi ca / nhờ làm hộ, chấm công bù) ở Tổng quan,
 * Yêu cầu và tin Telegram – KHÔNG giới hạn quyền: mọi admin được Admin Tổng cấp quyền vẫn thấy và duyệt được mọi cơ sở.
 * (adminStoreScope / storeFilterFor có sẵn nếu sau này cần lọc theo cơ sở.)
 */

/** null = mọi cơ sở; mảng = chỉ các cơ sở này */
export function adminStoreScope(a: Pick<AdminSession, "kind" | "storeIds">): string[] | null {
  if (a.kind === "OWNER") return null;
  return a.storeIds?.length ? a.storeIds : null;
}

export function adminManagesStore(a: Pick<AdminSession, "kind" | "storeIds">, storeId: unknown) {
  const scope = adminStoreScope(a);
  return !scope || scope.includes(String(storeId));
}

/** Điều kiện lọc Mongo theo cơ sở admin quản lý ({} = mọi cơ sở) */
export function storeFilterFor(a: Pick<AdminSession, "kind" | "storeIds">, field = "storeId") {
  const scope = adminStoreScope(a);
  return scope ? { [field]: { $in: scope } } : {};
}

/**
 * Danh bạ admin đang hoạt động (1 lần đọc DB) → hàm tra "ai cần xác nhận" cho 1 cơ sở:
 * admin có quyền `perm` (null = không cần quyền riêng, VD duyệt đổi ca) và quản lý cơ sở đó.
 * Ưu tiên admin được gán riêng cơ sở này; không có ai → admin quản lý mọi cơ sở; vẫn không có → "Admin Tổng".
 */
export async function adminDirectory() {
  await connectDB();
  const accs = await AdminAccount.find({ status: "ACTIVE" }).select("name storeIds perms").lean();
  return (storeId: unknown, perm: string | null): string[] => {
    const ok = accs.filter((a) => !perm || (a.perms ?? []).includes(perm));
    const own = ok.filter((a) => (a.storeIds ?? []).some((s: unknown) => String(s) === String(storeId)));
    if (own.length) return own.map((a) => a.name);
    const all = ok.filter((a) => !(a.storeIds ?? []).length);
    return all.length ? all.map((a) => a.name) : ["Admin Tổng"];
  };
}

/** Tên admin cần xác nhận cho 1 cơ sở (xem adminDirectory). */
export async function responsibleAdminNames(storeId: unknown, perm: string | null) {
  return (await adminDirectory())(storeId, perm);
}

/** Quyền cần để duyệt từng loại yêu cầu (null = mọi admin) – khớp với action duyệt tương ứng */
export const APPROVE_PERM = { overtime: "adjustments", adjustment: "adjustments", cover: null } as const;
