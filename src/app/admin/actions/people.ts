"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Device, Store, User, WageHistory } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { approveDevice } from "@/lib/device";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { localDate } from "@/lib/time";
import { errMsg, num, str, type FormState } from "./types";

/* ===== Duyệt đăng ký (spec 3.1) ===== */
export async function approveUser(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const user = await User.findById(str(fd.get("userId")));
    if (!user || user.status !== "PENDING") return { error: "Đăng ký không còn ở trạng thái chờ duyệt" };
    const wage = num(fd.get("hourlyWage"));
    user.status = "ACTIVE";
    user.joinedAt = user.joinedAt ?? new Date();
    if (wage > 0) user.hourlyWage = wage;
    await user.save();
    if (wage > 0) await WageHistory.create({ userId: user._id, hourlyWage: wage, effectiveFrom: localDate(new Date()), createdBy: admin.name });
    // duyệt luôn thiết bị đầu tiên
    const devs = await Device.find({ userId: user._id, status: "PENDING" }).sort({ firstSeenAt: -1 }).limit(1);
    for (const d of devs) await approveDevice(String(d._id), admin.name);
    await audit(adminActor(admin), "user.approve", { type: "User", id: String(user._id) }, null, { hourlyWage: wage });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function rejectUser(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const reason = str(fd.get("reason"));
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy" };
    user.status = "REJECTED";
    user.rejectReason = reason;
    await user.save();
    await Device.updateMany({ userId: user._id, status: "PENDING" }, { $set: { status: "REJECTED" } });
    await audit(adminActor(admin), "user.reject", { type: "User", id: String(user._id) }, null, { reason });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Quản lý nhân viên (spec 3.3) ===== */
export async function updateEmployee(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const before = { name: user.name, phone: user.phone, bankName: user.bankName, storeId: String(user.storeId), status: user.status };
    const name = str(fd.get("name"));
    if (name.length < 2) return { error: "Họ tên quá ngắn" };
    user.name = name;
    user.phone = str(fd.get("phone"));
    user.bankName = str(fd.get("bankName"));
    const acc = str(fd.get("bankAccount"));
    if (acc && !acc.includes("*")) user.bankAccountEnc = encrypt(acc);
    const storeId = str(fd.get("storeId"));
    if (storeId && (await Store.exists({ _id: storeId }))) user.storeId = storeId as never;
    const status = str(fd.get("status"));
    if (["ACTIVE", "INACTIVE"].includes(status)) user.status = status as "ACTIVE" | "INACTIVE";
    await user.save();
    await audit(adminActor(admin), "user.update", { type: "User", id: String(user._id) }, before, {
      name: user.name,
      phone: user.phone,
      bankName: user.bankName,
      storeId: String(user.storeId),
      status: user.status,
      bankAccountChanged: !!acc && !acc.includes("*"),
    });
    revalidatePath("/admin/employees", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Đổi lương giờ có ngày hiệu lực (hỗ trợ đổi lương giữa tháng). */
export async function setWage(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const wage = num(fd.get("hourlyWage"));
    const from = str(fd.get("effectiveFrom")) || localDate(new Date());
    if (wage <= 0) return { error: "Lương giờ phải > 0" };
    await WageHistory.create({ userId: user._id, hourlyWage: wage, effectiveFrom: from, createdBy: admin.name });
    const latest = await WageHistory.findOne({ userId: user._id, effectiveFrom: { $lte: localDate(new Date()) } }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();
    const before = user.hourlyWage;
    user.hourlyWage = latest?.hourlyWage ?? wage;
    await user.save();
    await audit(adminActor(admin), "user.wage", { type: "User", id: String(user._id) }, { hourlyWage: before }, { hourlyWage: wage, effectiveFrom: from });
    revalidatePath(`/admin/employees/${user._id}`);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Thiết bị (spec 4.1.1) ===== */
export async function deviceAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("deviceRefId"));
    const op = str(fd.get("op"));
    const dev = await Device.findById(id);
    if (!dev) return { error: "Không tìm thấy thiết bị" };
    if (op === "approve") await approveDevice(id, admin.name);
    else if (op === "revoke" || op === "reject") {
      dev.status = op === "revoke" ? "REVOKED" : "REJECTED";
      await dev.save();
    } else if (op === "delete") {
      // xoá hẳn để thiết bị có thể gắn lại cho người khác (VD máy chuyển nhượng)
      await dev.deleteOne();
    }
    await audit(adminActor(admin), `device.${op}`, { type: "Device", id }, null, { userId: String(dev.userId) });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Chuyển tài khoản: dữ liệu Gmail cũ → Gmail mới, rồi xoá tài khoản cũ ===== */
export async function previewAccountTransfer(fromId: string, toId: string) {
  try {
    await assertAdmin();
    const { previewMerge } = await import("@/lib/account-merge");
    return { ok: true as const, preview: await previewMerge(fromId, toId) };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function transferAccount(fromId: string, toId: string) {
  try {
    const admin = await assertAdmin();
    const { mergeUserAccount } = await import("@/lib/account-merge");
    const r = await mergeUserAccount(fromId, toId);
    await audit(adminActor(admin), "user.transfer", { type: "User", id: toId }, { userId: fromId, email: r.fromEmail }, { userId: toId, email: r.toEmail, moved: r.moved });
    revalidatePath("/admin", "layout");
    return { ok: true as const, toId };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

/* ===== Cấp quyền quản lý cho nhân viên (xếp ca / thưởng-phạt / duyệt đổi ca-làm hộ) ===== */
export async function setStaffPerms(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const { isStaffPerm } = await import("@/lib/permissions");
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const perms = fd.getAll("managerPerms").map(String).filter(isStaffPerm);
    const storeIds = fd
      .getAll("managerStoreIds")
      .map(String)
      .filter((id) => id !== String(user.storeId));
    const valid = (await Store.find({ _id: { $in: storeIds } }).select("_id").lean()).map((s) => s._id);
    const before = { managerPerms: [...(user.managerPerms ?? [])], managerStoreIds: (user.managerStoreIds ?? []).map(String) };
    user.set({ managerPerms: perms, managerStoreIds: valid });
    await user.save();
    await audit(adminActor(admin), "user.staffPerms", { type: "User", id: String(user._id) }, before, { managerPerms: perms, managerStoreIds: valid.map(String) });
    revalidatePath(`/admin/employees/${user._id}`);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Nhân viên không có tài khoản đăng nhập (VD đã nghỉ việc – để import chấm công / tính lương tháng cũ) ===== */
async function makeOfflineStaff(admin: Awaited<ReturnType<typeof assertAdmin>>, input: { name: string; storeId: string; hourlyWage: number; active: boolean; phone?: string }) {
  const { randomUUID } = await import("node:crypto");
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Nhập họ tên");
  if (!(await Store.exists({ _id: input.storeId }))) throw new Error("Chọn cơ sở");
  if (!(input.hourlyWage >= 0)) throw new Error("Lương giờ không hợp lệ");
  await connectDB();
  const user = await User.create({
    // email giả (không đăng nhập được bằng Google) – sau này có Gmail thì dùng "Chuyển sang tài khoản Gmail mới"
    email: `nv-${randomUUID()}@khong-dang-nhap.local`,
    name,
    phone: input.phone ?? "",
    storeId: input.storeId,
    hourlyWage: Math.round(input.hourlyWage),
    status: input.active ? "ACTIVE" : "INACTIVE",
    noLogin: true,
    joinedAt: new Date(),
  });
  if (input.hourlyWage > 0) await WageHistory.create({ userId: user._id, hourlyWage: Math.round(input.hourlyWage), effectiveFrom: "2000-01-01", createdBy: adminActor(admin).name });
  await audit(adminActor(admin), "user.createOffline", { type: "User", id: String(user._id) }, null, { name, storeId: input.storeId, hourlyWage: input.hourlyWage, status: user.status });
  revalidatePath("/admin", "layout");
  return user;
}

/** Form ở trang Nhân viên. */
export async function createOfflineStaff(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await makeOfflineStaff(admin, {
      name: str(fd.get("name")),
      storeId: str(fd.get("storeId")),
      hourlyWage: num(fd.get("hourlyWage")),
      active: str(fd.get("status")) === "ACTIVE",
      phone: str(fd.get("phone")),
    });
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Tạo nhanh từ màn Import Excel (sheet không khớp nhân viên nào) → trả id để gán luôn. */
export async function quickCreateOfflineStaff(name: string, storeId: string, hourlyWage: number): Promise<{ id?: string; name?: string; error?: string }> {
  try {
    const admin = await assertAdmin();
    const u = await makeOfflineStaff(admin, { name, storeId, hourlyWage, active: false });
    return { id: String(u._id), name: u.name };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
