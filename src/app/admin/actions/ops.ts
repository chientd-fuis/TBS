"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  AdjustmentRequest,
  Attendance,
  AttendanceAdjustment,
  BonusPenalty,
  Payroll,
  PayrollFeedback,
  APPROVED_SHIFT,
  ShiftAssignment,
  ShiftTemplate,
  Store,
  User,
} from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor, type AdminSession } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { assertNotLocked, computeFields, findShiftFor, payStoreOf, storeTz } from "@/lib/attendance";
import { addDays, localMonth, zonedToDate } from "@/lib/time";
import { generatePayroll, publishPayroll, updateItemExtras } from "@/lib/payroll";
import { errMsg, num, str, type FormState } from "./types";
import { extractSheetId } from "@/lib/revenue";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ===== Cửa hàng (spec 3.4) ===== */
export async function saveStore(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const id = str(fd.get("id"));
    const data = {
      code: str(fd.get("code")).toUpperCase(),
      name: str(fd.get("name")),
      address: str(fd.get("address")),
      lat: str(fd.get("lat")) ? Number(str(fd.get("lat")).replace(",", ".")) : null,
      lng: str(fd.get("lng")) ? Number(str(fd.get("lng")).replace(",", ".")) : null,
      radiusM: num(fd.get("radiusM"), 100) || 100,
      timezone: str(fd.get("timezone")) || "Asia/Ho_Chi_Minh",
      telegramChatId: str(fd.get("telegramChatId")),
      telegramAttendanceChatId: str(fd.get("telegramAttendanceChatId")),
      revenueSheetId: extractSheetId(str(fd.get("revenueSheetId"))),
      revenueTabPattern: str(fd.get("revenueTabPattern")) || "T{m}",
      revenueFirstRow: Math.max(1, num(fd.get("revenueFirstRow"), 3) || 3),
      revenueSheetLayout: str(fd.get("revenueSheetLayout")) === "LEGACY" ? "LEGACY" : "GRAB_COL",
      active: fd.get("active") === "on",
    };
    if (str(fd.get("revenueSheetId")) && !data.revenueSheetId) return { error: "Link Google Sheet không hợp lệ" };
    if (!data.code || !data.name) return { error: "Nhập mã và tên cơ sở" };
    if ((data.lat != null && !Number.isFinite(data.lat)) || (data.lng != null && !Number.isFinite(data.lng)))
      return { error: "Toạ độ không hợp lệ" };
    if ((data.lat == null) !== (data.lng == null)) return { error: "Nhập đủ cả vĩ độ và kinh độ" };
    if (data.lat != null && (Math.abs(data.lat) > 90 || Math.abs(data.lng!) > 180)) return { error: "Toạ độ không hợp lệ" };
    const dup = await Store.findOne(id ? { code: data.code, _id: { $ne: id } } : { code: data.code }).lean();
    if (dup) return { error: "Mã cơ sở đã tồn tại" };
    if (id) {
      const before = await Store.findById(id).lean();
      await Store.updateOne({ _id: id }, { $set: data });
      await audit(adminActor(admin), "store.update", { type: "Store", id }, before, data);
    } else {
      const s = await Store.create(data);
      await audit(adminActor(admin), "store.create", { type: "Store", id: String(s._id) }, null, data);
    }
    revalidatePath("/admin/stores");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Ca làm việc (spec 3.2) ===== */
export async function saveShiftTemplate(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const data = {
      storeId: str(fd.get("storeId")),
      name: str(fd.get("name")),
      startTime: str(fd.get("startTime")),
      endTime: str(fd.get("endTime")),
      active: fd.get("active") !== "off",
    };
    if (!data.storeId || !data.name) return { error: "Chọn cơ sở và nhập tên ca" };
    if (!TIME_RE.test(data.startTime) || !TIME_RE.test(data.endTime)) return { error: "Giờ không hợp lệ (HH:mm)" };
    if (data.startTime === data.endTime) return { error: "Giờ bắt đầu và kết thúc phải khác nhau" };
    if (id) await ShiftTemplate.updateOne({ _id: id }, { $set: data });
    else await ShiftTemplate.create(data);
    await audit(adminActor(admin), id ? "shift.template.update" : "shift.template.create", { type: "ShiftTemplate", id }, null, data);
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Xếp ca hàng loạt: nhiều nhân viên × khoảng ngày × thứ trong tuần. */
export async function assignShifts(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const tpl = await ShiftTemplate.findById(str(fd.get("templateId"))).lean();
    if (!tpl) return { error: "Chọn ca" };
    const userIds = fd.getAll("userIds").map(String).filter(Boolean);
    if (!userIds.length) return { error: "Chọn ít nhất 1 nhân viên" };
    const from = str(fd.get("from"));
    const to = str(fd.get("to")) || from;
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return { error: "Khoảng ngày không hợp lệ" };
    if (addDays(from, 62) < to) return { error: "Tối đa 62 ngày mỗi lần" };
    const weekdays = fd.getAll("weekdays").map(Number);
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (weekdays.length && !weekdays.includes(wd)) continue;
      for (const uid of userIds) {
        const r = await ShiftAssignment.updateOne(
          { userId: uid, date: d, shiftTemplateId: tpl._id },
          { $set: { storeId: tpl.storeId, startTime: tpl.startTime, endTime: tpl.endTime, shiftName: tpl.name, status: "APPROVED", source: "BULK", decidedBy: adminActor(admin).name, decidedAt: new Date() } },
          { upsert: true },
        );
        n += r.upsertedCount;
      }
    }
    await audit(adminActor(admin), "shift.assign", { type: "ShiftTemplate", id: String(tpl._id) }, null, { userIds, from, to, weekdays, created: n });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function removeAssignment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const a = await ShiftAssignment.findByIdAndDelete(id).lean();
    await audit(adminActor(admin), "shift.unassign", { type: "ShiftAssignment", id }, a, null);
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Copy lịch tuần trước sang tuần đang xem. */
export async function copyPrevWeek(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const storeId = str(fd.get("storeId"));
    const weekStart = str(fd.get("weekStart"));
    const prev = await ShiftAssignment.find({ storeId, date: { $gte: addDays(weekStart, -7), $lt: weekStart }, ...APPROVED_SHIFT }).lean();
    let n = 0;
    for (const a of prev) {
      const r = await ShiftAssignment.updateOne(
        { userId: a.userId, date: addDays(a.date, 7), shiftTemplateId: a.shiftTemplateId },
        { $setOnInsert: { storeId, startTime: a.startTime, endTime: a.endTime, shiftName: a.shiftName, status: "APPROVED", source: "BULK" } },
        { upsert: true },
      );
      n += r.upsertedCount;
    }
    await audit(adminActor(admin), "shift.copyWeek", { type: "Store", id: storeId }, null, { weekStart, created: n });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Chấm công: chấm hộ / sửa / xoá (spec 3.5, 7.1) ===== */
async function upsertAttendance(
  admin: AdminSession,
  opts: {
    id?: string;
    userId: string;
    date: string;
    inTime: string;
    outTime: string;
    reason: string;
    source: "ADMIN_MANUAL" | "REQUEST";
    /** cơ sở làm việc (đi hỗ trợ). Bỏ trống → theo ca đã xếp, không có ca thì cơ sở gốc */
    workStoreId?: string;
  },
) {
  const user = await User.findById(opts.userId).lean();
  if (!user?.storeId) throw new Error("Nhân viên chưa thuộc cơ sở nào");
  if (!DATE_RE.test(opts.date)) throw new Error("Ngày không hợp lệ");
  if (opts.inTime && !TIME_RE.test(opts.inTime.slice(0, 5))) throw new Error("Giờ vào không hợp lệ");
  if (opts.outTime && !TIME_RE.test(opts.outTime.slice(0, 5))) throw new Error("Giờ ra không hợp lệ");
  if (opts.reason.length < 3) throw new Error("Bắt buộc nhập lý do");

  const existing = opts.id ? await Attendance.findById(opts.id) : null;
  const homeStoreId = existing ? payStoreOf(existing) : user.storeId;
  let storeId = existing?.storeId ?? (opts.workStoreId ? new Types.ObjectId(opts.workStoreId) : user.storeId);
  if (opts.workStoreId && !(await Store.exists({ _id: opts.workStoreId }))) throw new Error("Cơ sở làm việc không hợp lệ");
  let tz = await storeTz(storeId);
  const checkInAt = opts.inTime ? zonedToDate(opts.date, opts.inTime, tz) : existing?.checkInAt;
  if (!checkInAt) throw new Error("Cần giờ vào");
  if (!existing && !opts.workStoreId) {
    // chấm hộ / duyệt yêu cầu: nếu hôm đó nhân viên có ca hỗ trợ ở cơ sở khác → ghi vào cơ sở đó
    const any = await findShiftFor(opts.userId, checkInAt, tz);
    if (any && String(any.a.storeId) !== String(storeId)) {
      storeId = any.a.storeId;
      tz = await storeTz(storeId);
    }
  }
  let checkOutAt: Date | null = opts.outTime ? zonedToDate(opts.date, opts.outTime, tz) : (existing?.checkOutAt ?? null);
  if (checkOutAt && checkOutAt <= checkInAt) checkOutAt = new Date(checkOutAt.getTime() + 24 * 3600_000); // qua đêm
  if (checkOutAt && checkOutAt.getTime() - checkInAt.getTime() > 24 * 3600_000) throw new Error("Lượt làm việc không quá 24 giờ");

  const month = localMonth(checkInAt, tz);
  await assertNotLocked(homeStoreId, month); // khoá theo bảng lương cơ sở gốc
  if (existing && existing.month !== month) await assertNotLocked(homeStoreId, existing.month);

  // luôn tìm lại ca theo giờ vào mới (sửa ngày/giờ thì ca cũ có thể không còn đúng)
  const shift = await findShiftFor(opts.userId, checkInAt, tz, storeId);
  const shiftAssignmentId = shift?.a._id ?? null;
  const fields = await computeFields({ storeId, shiftAssignmentId, checkInAt, checkOutAt });
  const status = checkOutAt ? "COMPLETED" : "OPEN";
  if (status === "OPEN") {
    const other = await Attendance.findOne({ userId: opts.userId, status: "OPEN", _id: { $ne: existing?._id } }).lean();
    if (other) throw new Error("Nhân viên đang có một lượt chưa check-out – hãy nhập cả giờ ra");
  }

  const set = {
    ...fields,
    userId: opts.userId,
    storeId,
    homeStoreId,
    checkInAt,
    checkOutAt,
    status,
    shiftAssignmentId,
    shiftLabel: fields.shiftLabel ?? null,
    outOfShift: !shift,
    ...(checkOutAt ? {} : { totalHours: null, roundedHours: null, earlyMinutes: 0 }),
  };
  const actor = adminActor(admin);
  if (existing) {
    const before = existing.toObject();
    existing.set({ ...set, note: [existing.note, `Sửa bởi ${admin.name}: ${opts.reason}`].filter(Boolean).join(" | ") });
    await existing.save();
    await AttendanceAdjustment.create({
      attendanceId: existing._id,
      adminName: actor.name,
      action: "UPDATE",
      before: { checkInAt: before.checkInAt, checkOutAt: before.checkOutAt, status: before.status },
      after: { checkInAt, checkOutAt, status },
      reason: opts.reason,
    });
    await audit(actor, "attendance.update", { type: "Attendance", id: String(existing._id) }, { checkInAt: before.checkInAt, checkOutAt: before.checkOutAt }, { checkInAt, checkOutAt, reason: opts.reason });
    return existing;
  }
  const created = await Attendance.create({
    ...set,
    source: opts.source,
    createdByAdminName: actor.name,
    manualReason: opts.reason,
  });
  await AttendanceAdjustment.create({ attendanceId: created._id, adminName: actor.name, action: "CREATE", after: { checkInAt, checkOutAt }, reason: opts.reason });
  await audit(actor, opts.source === "REQUEST" ? "attendance.request.create" : "attendance.manual", { type: "Attendance", id: String(created._id) }, null, {
    userId: opts.userId,
    checkInAt,
    checkOutAt,
    reason: opts.reason,
  });
  return created;
}

/** Chấm công hộ – không cần nhân viên xác nhận (spec 3.5). */
export async function manualAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await upsertAttendance(admin, {
      userId: str(fd.get("userId")),
      date: str(fd.get("date")),
      inTime: str(fd.get("inTime")),
      outTime: str(fd.get("outTime")),
      reason: str(fd.get("reason")),
      source: "ADMIN_MANUAL",
      workStoreId: str(fd.get("workStoreId")) || undefined,
    });
    revalidatePath("/admin/attendance");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function editAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const a = await Attendance.findById(id).lean();
    if (!a) return { error: "Không tìm thấy" };
    await upsertAttendance(admin, {
      id,
      userId: String(a.userId),
      date: str(fd.get("date")) || a.workDate,
      inTime: str(fd.get("inTime")),
      outTime: str(fd.get("outTime")),
      reason: str(fd.get("reason")),
      source: "ADMIN_MANUAL",
    });
    revalidatePath("/admin/attendance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const reason = str(fd.get("reason"));
    if (reason.length < 3) return { error: "Nhập lý do xoá" };
    const a = await Attendance.findById(id);
    if (!a) return { error: "Không tìm thấy" };
    await assertNotLocked(payStoreOf(a), a.month);
    await AttendanceAdjustment.create({ attendanceId: a._id, adminName: adminActor(admin).name, action: "DELETE", before: a.toObject(), reason });
    await audit(adminActor(admin), "attendance.delete", { type: "Attendance", id }, a.toObject(), { reason });
    await a.deleteOne();
    revalidatePath("/admin/attendance", "layout");
    redirect(`/admin/attendance?store=${a.storeId}&user=${a.userId}&month=${a.month}`);
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Thưởng / phạt – admin nhập tự do (spec 3.6) ===== */
export async function createBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const userId = str(fd.get("userId"));
    const user = await User.findById(userId).lean();
    if (!user?.storeId) return { error: "Chọn nhân viên" };
    const kind = str(fd.get("kind")) === "BONUS" ? "BONUS" : "PENALTY";
    const date = str(fd.get("date"));
    const amountVnd = Math.round(num(fd.get("amountVnd")));
    const content = str(fd.get("content"));
    if (!DATE_RE.test(date)) return { error: "Chọn ngày áp dụng" };
    if (amountVnd <= 0) return { error: "Số tiền phải > 0" };
    if (content.length < 3) return { error: "Nhập nội dung" };
    const attendanceId = str(fd.get("attendanceId")) || undefined;
    const month = date.slice(0, 7);
    await assertNotLocked(user.storeId, month);
    const bp = await BonusPenalty.create({ userId, storeId: user.storeId, kind, date, month, amountVnd, content, attendanceId, createdBy: adminActor(admin).name });
    await audit(adminActor(admin), "bonusPenalty.create", { type: "BonusPenalty", id: String(bp._id) }, null, { userId, kind, amountVnd, content, date });
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Sửa khoản thưởng/phạt (khi tháng chưa chốt). */
export async function updateBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const bp = await BonusPenalty.findById(str(fd.get("id")));
    if (!bp) return { error: "Không tìm thấy" };
    const date = str(fd.get("date"));
    const amountVnd = Math.round(num(fd.get("amountVnd")));
    const content = str(fd.get("content"));
    if (!DATE_RE.test(date)) return { error: "Ngày không hợp lệ" };
    if (amountVnd <= 0) return { error: "Số tiền phải > 0" };
    if (content.length < 3) return { error: "Nhập nội dung" };
    await assertNotLocked(bp.storeId, bp.month); // tháng cũ
    await assertNotLocked(bp.storeId, date.slice(0, 7)); // tháng mới (nếu đổi ngày)
    const before = bp.toObject();
    bp.set({ kind: str(fd.get("kind")) === "BONUS" ? "BONUS" : "PENALTY", date, month: date.slice(0, 7), amountVnd, content });
    await bp.save();
    await audit(adminActor(admin), "bonusPenalty.update", { type: "BonusPenalty", id: String(bp._id) }, before, bp.toObject());
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const bp = await BonusPenalty.findById(str(fd.get("id")));
    if (!bp) return { error: "Không tìm thấy" };
    await assertNotLocked(bp.storeId, bp.month);
    await audit(adminActor(admin), "bonusPenalty.delete", { type: "BonusPenalty", id: String(bp._id) }, bp.toObject(), null);
    await bp.deleteOne();
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Bảng lương (spec 3.7) ===== */
export async function payrollAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    const op = str(fd.get("op"));
    const storeId = str(fd.get("storeId"));
    const month = str(fd.get("month"));
    if (op === "generate") {
      const p = await generatePayroll(storeId, month);
      if (p.status !== "DRAFT") return { error: "Bảng lương đã công bố – mở khoá nếu cần tính lại" };
      await audit(actor, "payroll.generate", { type: "Payroll", id: String(p._id) });
    } else if (op === "publish") {
      const tz = await storeTz(storeId);
      if (month >= localMonth(new Date(), tz)) return { error: "Chỉ công bố được bảng lương của tháng đã kết thúc" };
      const p = await Payroll.findOne({ storeId, month });
      if (!p) return { error: "Chưa có bảng lương" };
      const r = await publishPayroll(p._id, actor.name);
      if (!r) return { error: "Bảng lương không ở trạng thái nháp" };
      await audit(actor, "payroll.publish", { type: "Payroll", id: String(p._id) });
    } else if (op === "paid") {
      await Payroll.updateOne({ storeId, month, status: "PUBLISHED" }, { $set: { status: "PAID", paidAt: new Date() } });
      await audit(actor, "payroll.paid", { type: "Payroll", id: `${storeId}:${month}` });
    } else if (op === "unlock") {
      const reason = str(fd.get("reason"));
      if (reason.length < 3) return { error: "Nhập lý do mở khoá" };
      await Payroll.updateOne({ storeId, month }, { $set: { status: "DRAFT", unlockedAt: new Date() }, $unset: { publishedAt: 1, paidAt: 1 } });
      await audit(actor, "payroll.unlock", { type: "Payroll", id: `${storeId}:${month}` }, null, { reason });
    }
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function savePayrollExtras(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const itemId = str(fd.get("itemId"));
    await updateItemExtras(itemId, num(fd.get("allowance")), num(fd.get("advance")));
    await audit(adminActor(admin), "payroll.item.extras", { type: "PayrollItem", id: itemId }, null, { allowance: num(fd.get("allowance")), advance: num(fd.get("advance")) });
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Yêu cầu điều chỉnh & phản hồi lương ===== */
export async function resolveAdjustment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const req = await AdjustmentRequest.findById(str(fd.get("id")));
    if (!req || req.status !== "PENDING") return { error: "Yêu cầu đã được xử lý" };
    const op = str(fd.get("op"));
    const reply = str(fd.get("reply"));
    if (op === "approve") {
      let target = req.attendanceId ? await Attendance.findById(req.attendanceId).lean() : null;
      if (!target && req.workDate) {
        // lượt cùng ngày đang thiếu giờ ra
        target = await Attendance.findOne({ userId: req.userId, workDate: req.workDate, status: { $in: ["OPEN", "MISSING_CHECKOUT"] } }).lean();
      }
      await upsertAttendance(admin, {
        id: target ? String(target._id) : undefined,
        userId: String(req.userId),
        date: req.workDate || (target?.workDate ?? ""),
        inTime: str(fd.get("inTime")) || req.checkInTime || "",
        outTime: str(fd.get("outTime")) || req.checkOutTime || "",
        reason: `Yêu cầu NV: ${req.reason}`,
        source: "REQUEST",
      });
      req.status = "APPROVED";
    } else {
      req.status = "REJECTED";
    }
    req.adminName = adminActor(admin).name;
    req.adminReply = reply;
    req.resolvedAt = new Date();
    await req.save();
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function replyFeedback(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const reply = str(fd.get("reply"));
    if (reply.length < 2) return { error: "Nhập nội dung phản hồi" };
    await PayrollFeedback.updateOne({ _id: str(fd.get("id")) }, { $set: { adminReply: reply, adminName: adminActor(admin).name, status: "RESOLVED" } });
    revalidatePath("/admin/requests");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
