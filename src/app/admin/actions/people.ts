"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { AdminAccount, Device, ProbationRequest, SalaryHistory, Store, User, WageHistory } from "@/lib/models";
import { assertAdmin, assertOwner } from "@/lib/guards";
import { isOwnerEmail } from "@/lib/auth";
import { isPayType, payTermsAt, type PayType } from "@/lib/salary";
import { adminActor } from "@/lib/admin-session";
import { approveDevice } from "@/lib/device";
import { encrypt } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { localDate, localMonth } from "@/lib/time";
import { dec, errMsg, num, str, type FormState } from "./types";
import { makeOfficial, PROBATION_WAGE } from "@/lib/probation";

/* ===== Duyệt đăng ký (spec 3.1) ===== */
export async function approveUser(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const user = await User.findById(str(fd.get("userId")));
    if (!user || user.status !== "PENDING") return { error: "Đăng ký không còn ở trạng thái chờ duyệt" };
    // thử việc: lương trống → mặc định 20.000đ/giờ; 3 ca đầu = ca thử việc → admin Nhận / Không nhận; hết tháng → hỏi lên 22k (lib/probation.ts)
    const probation = fd.get("probation") === "on";
    const wage = num(fd.get("hourlyWage")) || (probation ? PROBATION_WAGE : 0);
    const today = localDate(new Date());
    user.status = "ACTIVE";
    user.joinedAt = user.joinedAt ?? new Date();
    if (wage > 0) user.hourlyWage = wage;
    if (probation) user.set({ probation: true, probationStart: today, probationReview: false, trialStage: "ON" });
    await user.save();
    if (wage > 0) await WageHistory.create({ userId: user._id, hourlyWage: wage, effectiveFrom: today, createdBy: admin.name });
    // duyệt luôn thiết bị đầu tiên
    const devs = await Device.find({ userId: user._id, status: "PENDING" }).sort({ firstSeenAt: -1 }).limit(1);
    for (const d of devs) await approveDevice(String(d._id), admin.name);
    await audit(adminActor(admin), "user.approve", { type: "User", id: String(user._id) }, null, { hourlyWage: wage, probation });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/**
 * Thử việc của 1 nhân viên:
 *  - start: đặt thử việc từ hôm nay (lương giờ trống → 20.000đ)
 *  - official: chuyển chính thức ngay (lương trống → 22.000đ, giữ lương cao hơn nếu đang cao hơn)
 *  - extend: gia hạn thử việc thêm 1 tháng từ hôm nay (bỏ "cần xem xét")
 *  - stop: bỏ thử việc, giữ nguyên lương
 */
export async function probationAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const op = str(fd.get("op"));
    const by = adminActor(admin).name;
    const today = localDate(new Date());
    const wage = Math.round(num(fd.get("hourlyWage")));
    if (op === "start") {
      const w = wage > 0 ? wage : PROBATION_WAGE;
      const raise = w !== user.hourlyWage;
      // 3 ca đầu từ hôm nay = ca thử việc
      user.set({ probation: true, probationStart: today, probationReview: false, hourlyWage: w, trialStage: "ON" });
      await user.save();
      if (raise) await WageHistory.create({ userId: user._id, hourlyWage: w, effectiveFrom: today, createdBy: by });
    } else if (op === "official") {
      if (!user.probation) return { error: "Nhân viên không ở chế độ thử việc" };
      await makeOfficial(user._id, today, by, wage > 0 ? wage : undefined);
    } else if (op === "extend") {
      if (!user.probation) return { error: "Nhân viên không ở chế độ thử việc" };
      user.set({ probationStart: today, probationReview: false });
      await user.save();
    } else if (op === "stop") {
      user.set({ probation: false, probationReview: false, probationEndedAt: new Date() });
      if (user.trialStage === "ON" || user.trialStage === "PENDING") user.set({ trialStage: "DONE" });
      await user.save();
    } else return { error: "Thao tác không hợp lệ" };
    // chuyển chính thức / bỏ thử việc ở trang nhân viên → đóng yêu cầu thử việc đang chờ
    if (op === "official" || op === "stop")
      await ProbationRequest.updateMany(
        { userId: user._id, status: "PENDING" },
        { $set: { status: "APPROVED", decidedBy: by, decidedAt: new Date(), reply: op === "official" ? "Chuyển chính thức ở trang nhân viên" : "Bỏ thử việc ở trang nhân viên" } },
      );
    await audit(adminActor(admin), `user.probation.${op}`, { type: "User", id: String(user._id) }, null, { wage: wage || undefined });
    revalidatePath("/admin/employees", "layout");
    revalidatePath("/", "layout");
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

/* ===== Hình thức lương: part-time (lương giờ) / full-time (lương cứng tháng) ===== */
const MONTH_RE = /^\d{4}-\d{2}$/;
type UserInstance = InstanceType<typeof User>;

/**
 * Đổi hình thức lương từ tháng `month`: thêm mốc SalaryHistory nếu khác mức đang áp dụng tháng đó,
 * rồi cập nhật payType / monthlySalary hiện tại của user (= mức áp dụng tháng này). KHÔNG save user.
 */
async function applyPayTerms(user: UserInstance, payType: PayType, monthlySalary: number, month: string, by: string, paidLeaveDays = 0) {
  if (!MONTH_RE.test(month)) throw new Error("Tháng hiệu lực không hợp lệ");
  const salary = payType === "FULLTIME" ? Math.round(monthlySalary) : 0;
  if (payType === "FULLTIME" && !(salary > 0)) throw new Error("Nhập lương cứng / tháng");
  if (salary > 1_000_000_000) throw new Error("Lương cứng quá lớn");
  // ngày nghỉ có lương: bước 0,5 ngày, < 28 (để số ngày công chuẩn luôn > 0)
  const leave = payType === "FULLTIME" ? Math.round(paidLeaveDays * 2) / 2 : 0;
  if (!(leave >= 0 && leave < 28)) throw new Error("Số ngày nghỉ có lương không hợp lệ (0 – 27)");
  const cur = payTermsAt(await SalaryHistory.find({ userId: user._id }).lean(), month);
  const changed = cur.payType !== payType || cur.monthlySalary !== salary || cur.paidLeaveDays !== leave;
  if (changed) await SalaryHistory.create({ userId: user._id, payType, monthlySalary: salary, paidLeaveDays: leave, effectiveMonth: month, createdBy: by });
  const now = payTermsAt(await SalaryHistory.find({ userId: user._id }).lean(), localMonth(new Date()));
  user.payType = now.payType;
  user.monthlySalary = now.monthlySalary;
  user.paidLeaveDays = now.paidLeaveDays;
  return changed;
}

/** Card "Hình thức lương" ở Chi tiết nhân viên. */
export async function setPayTerms(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const payType = str(fd.get("payType"));
    if (!isPayType(payType)) return { error: "Chọn hình thức lương" };
    const month = str(fd.get("effectiveMonth")) || localMonth(new Date());
    const before = { payType: user.payType, monthlySalary: user.monthlySalary, paidLeaveDays: user.paidLeaveDays };
    const changed = await applyPayTerms(user, payType, num(fd.get("monthlySalary")), month, adminActor(admin).name, dec(fd.get("paidLeaveDays")));
    if (!changed) return { error: "Hình thức lương tháng này không đổi" };
    await user.save();
    await audit(adminActor(admin), "user.payTerms", { type: "User", id: String(user._id) }, before, { payType, monthlySalary: num(fd.get("monthlySalary")), paidLeaveDays: user.paidLeaveDays, effectiveMonth: month });
    revalidatePath("/admin/employees", "layout");
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/**
 * Admin Tổng: tạo hồ sơ nhân viên cho 1 admin (cùng Gmail) để admin có dòng trong bảng lương.
 * Gmail đã có hồ sơ nhân viên → dùng lại hồ sơ đó (đánh dấu admin, kích hoạt, đặt lương).
 */
export async function createAdminStaff(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const owner = await assertOwner();
    await connectDB();
    const email = str(fd.get("email")).toLowerCase();
    const acc = await AdminAccount.findOne({ email }).lean();
    if (!acc && !isOwnerEmail(email)) return { error: "Chọn admin" };
    const storeId = str(fd.get("storeId"));
    if (!(await Store.exists({ _id: storeId }))) return { error: "Chọn cơ sở" };
    const payType = str(fd.get("payType"));
    if (!isPayType(payType)) return { error: "Chọn hình thức lương" };
    const wage = Math.round(num(fd.get("hourlyWage")));
    if (payType === "HOURLY" && !(wage > 0)) return { error: "Nhập lương giờ" };
    const name = (str(fd.get("name")) || acc?.name || "").replace(/\s+/g, " ").slice(0, 80);
    if (name.length < 2) return { error: "Nhập họ tên" };
    const by = adminActor(owner).name;
    let user = await User.findOne({ email });
    if (user?.adminStaff) return { error: "Admin này đã có hồ sơ nhân viên – sửa lương ở danh sách / Chi tiết" };
    if (!user) user = new User({ email, joinedAt: new Date() });
    user.set({ name, storeId, status: "ACTIVE", adminStaff: true, joinedAt: user.joinedAt ?? new Date() });
    if (payType === "HOURLY" && wage !== user.hourlyWage) {
      user.hourlyWage = wage;
      await WageHistory.create({ userId: user._id, hourlyWage: wage, effectiveFrom: "2000-01-01", createdBy: by });
    }
    await applyPayTerms(user, payType, num(fd.get("monthlySalary")), str(fd.get("effectiveMonth")) || localMonth(new Date()), by, dec(fd.get("paidLeaveDays")));
    await user.save();
    await audit(adminActor(owner), "user.createAdminStaff", { type: "User", id: String(user._id) }, null, { email, name, storeId, payType, hourlyWage: wage, monthlySalary: user.monthlySalary });
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
async function makeOfflineStaff(
  admin: Awaited<ReturnType<typeof assertAdmin>>,
  input: { name: string; storeId: string; hourlyWage: number; active: boolean; phone?: string; payType?: PayType; monthlySalary?: number; paidLeaveDays?: number },
) {
  const { randomUUID } = await import("node:crypto");
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (name.length < 2) throw new Error("Nhập họ tên");
  if (!(await Store.exists({ _id: input.storeId }))) throw new Error("Chọn cơ sở");
  if (!(input.hourlyWage >= 0)) throw new Error("Lương giờ không hợp lệ");
  const payType = input.payType ?? "HOURLY";
  if (payType === "FULLTIME" && !((input.monthlySalary ?? 0) > 0)) throw new Error("Nhập lương cứng / tháng");
  await connectDB();
  const user = new User({
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
  // full-time tạo mới: lương cứng áp dụng cho mọi tháng (kể cả tháng cũ cần import chấm công)
  if (payType === "FULLTIME") await applyPayTerms(user, "FULLTIME", input.monthlySalary ?? 0, "2000-01", adminActor(admin).name, input.paidLeaveDays ?? 0);
  await user.save();
  if (input.hourlyWage > 0) await WageHistory.create({ userId: user._id, hourlyWage: Math.round(input.hourlyWage), effectiveFrom: "2000-01-01", createdBy: adminActor(admin).name });
  await audit(adminActor(admin), "user.createOffline", { type: "User", id: String(user._id) }, null, { name, storeId: input.storeId, hourlyWage: input.hourlyWage, payType, monthlySalary: user.monthlySalary, status: user.status });
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
      payType: str(fd.get("payType")) === "FULLTIME" ? "FULLTIME" : "HOURLY",
      monthlySalary: num(fd.get("monthlySalary")),
      paidLeaveDays: dec(fd.get("paidLeaveDays")),
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

/**
 * Sửa nhanh từ danh sách nhân viên (popup): họ tên + lương giờ.
 * Lương đổi → thêm mức lương hiệu lực từ ngày chọn (mặc định hôm nay); bảng lương nháp tự tính lại khi mở.
 */
export async function quickEditEmployee(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const user = await User.findById(str(fd.get("userId")));
    if (!user) return { error: "Không tìm thấy nhân viên" };
    const name = str(fd.get("name")).replace(/\s+/g, " ").slice(0, 80);
    if (name.length < 2) return { error: "Họ tên quá ngắn" };
    const payType: PayType = str(fd.get("payType")) === "FULLTIME" ? "FULLTIME" : "HOURLY";
    const wage = Math.round(num(fd.get("hourlyWage")));
    if (payType === "HOURLY" && !(wage > 0)) return { error: "Lương giờ phải > 0" };
    const from = str(fd.get("effectiveFrom")) || localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Ngày hiệu lực không hợp lệ" };
    const before = { name: user.name, hourlyWage: user.hourlyWage, payType: user.payType, monthlySalary: user.monthlySalary };
    user.name = name;
    // hình thức lương đổi theo tháng (tháng của ngày hiệu lực)
    await applyPayTerms(user, payType, num(fd.get("monthlySalary")), from.slice(0, 7), adminActor(admin).name, dec(fd.get("paidLeaveDays")));
    if (payType === "HOURLY" && wage !== user.hourlyWage) {
      await WageHistory.create({ userId: user._id, hourlyWage: wage, effectiveFrom: from, createdBy: adminActor(admin).name });
      // lương hiện tại = mức có hiệu lực tới hôm nay (ngày hiệu lực ở tương lai → giữ lương cũ tới ngày đó)
      const latest = await WageHistory.findOne({ userId: user._id, effectiveFrom: { $lte: localDate(new Date()) } }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();
      user.hourlyWage = latest?.hourlyWage ?? wage;
    }
    await user.save();
    await audit(adminActor(admin), "user.update", { type: "User", id: String(user._id) }, before, { name, hourlyWage: wage, payType, monthlySalary: user.monthlySalary, effectiveFrom: from });
    revalidatePath("/admin/employees", "layout");
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
