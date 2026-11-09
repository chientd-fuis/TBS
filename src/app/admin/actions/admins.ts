"use server";
import { revalidatePath } from "next/cache";
import { AdminAccount, AdminLoginSession, User } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { isOwnerEmail } from "@/lib/auth";
import { isAdminPerm } from "@/lib/permissions";
import { errMsg, str, type FormState } from "./types";

/* Chủ quản lý admin (đăng nhập Gmail): thêm Gmail, duyệt yêu cầu, phân quyền, đổi tên, khoá, xoá, đăng xuất. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const permsOf = (fd: FormData) => fd.getAll("perms").map(String).filter(isAdminPerm);

/** Đăng xuất mọi phiên của 1 tài khoản (hoặc 1 thiết bị). */
async function revoke(accountId: unknown, by: string, deviceId?: string) {
  await AdminLoginSession.updateMany({ accountId, revokedAt: null, ...(deviceId ? { deviceId } : {}) }, { $set: { revokedAt: new Date(), revokedBy: by } });
}

/** Gmail vừa đăng nhập để xin quyền có thể đã tạo hồ sơ nhân viên trống (chưa đăng ký) → xoá cho gọn. */
async function dropEmptyUser(email: string) {
  await User.deleteOne({ email, status: "NEW", storeId: { $exists: false } }).catch(() => null);
}

const done = () => {
  revalidatePath("/admin/admins");
  return { ok: true } as const;
};

async function load(fd: FormData) {
  const owner = await assertOwner();
  await connectDB();
  const acc = await AdminAccount.findById(str(fd.get("id")));
  if (!acc) throw new Error("Không tìm thấy tài khoản admin");
  return { owner, acc, actor: adminActor(owner) };
}

/** Chủ thêm Gmail admin – có hiệu lực ngay. */
export async function addAdminAccount(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const owner = await assertOwner();
    await connectDB();
    const email = str(fd.get("email")).toLowerCase();
    const name = str(fd.get("name")).replace(/\s+/g, " ").slice(0, 60);
    if (!EMAIL_RE.test(email)) return { error: "Gmail không hợp lệ" };
    if (isOwnerEmail(email)) return { error: "Đây là Gmail của Chủ" };
    if (name.length < 2) return { error: "Nhập tên hiển thị" };
    if (await AdminAccount.exists({ email })) return { error: "Gmail này đã có trong danh sách" };
    const perms = permsOf(fd);
    const acc = await AdminAccount.create({ email, name, perms, status: "ACTIVE", approvedBy: owner.email, approvedAt: new Date() });
    await dropEmptyUser(email);
    await audit(adminActor(owner), "admin.account.approve", { type: "AdminAccount", id: String(acc._id) }, null, { email, name, perms });
    return done();
  } catch (e) {
    return errMsg(e);
  }
}

/** Lưu tên, ghi chú, quyền; tài khoản đang chờ → duyệt luôn. */
export async function saveAdminAccount(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { owner, acc, actor } = await load(fd);
    const name = str(fd.get("name")).replace(/\s+/g, " ").slice(0, 60);
    if (name.length < 2) return { error: "Tên quá ngắn" };
    const perms = permsOf(fd);
    const before = { name: acc.name, status: acc.status, perms: [...acc.perms] };
    const approve = str(fd.get("approve")) === "1" && acc.status !== "ACTIVE";
    acc.set({ name, perms, note: str(fd.get("note")).slice(0, 200) });
    if (approve) acc.set({ status: "ACTIVE", approvedBy: owner.email, approvedAt: new Date() });
    await acc.save();
    if (approve) await dropEmptyUser(acc.email);
    await audit(actor, approve ? "admin.account.approve" : "admin.account.update", { type: "AdminAccount", id: String(acc._id) }, before, { name, perms, status: acc.status });
    return done();
  } catch (e) {
    return errMsg(e);
  }
}

export async function setAdminStatus(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { acc, actor } = await load(fd);
    const op = str(fd.get("op"));
    if (op === "logout") await revoke(acc._id, "Chủ đăng xuất");
    else if (op === "block") {
      acc.status = "BLOCKED";
      await acc.save();
      await revoke(acc._id, "Chủ khoá tài khoản");
    } else if (op === "unblock") {
      acc.status = "ACTIVE";
      await acc.save();
    } else if (op === "delete") {
      await revoke(acc._id, "Chủ xoá tài khoản");
      await AdminAccount.deleteOne({ _id: acc._id });
    } else return { error: "Thao tác không hợp lệ" };
    await audit(actor, `admin.account.${op}`, { type: "AdminAccount", id: String(acc._id) }, { name: acc.name, email: acc.email }, null);
    return done();
  } catch (e) {
    return errMsg(e);
  }
}
