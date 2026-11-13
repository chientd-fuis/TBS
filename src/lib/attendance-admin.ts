import { Types } from "mongoose";
import { Attendance, AttendanceAdjustment, Store, User } from "./models";
import { adminActor, type AdminSession } from "./admin-session";
import { audit } from "./audit";
import { assertNotLocked, computeFields, findShiftFor, payStoreOf, storeTz } from "./attendance";
import { localMonth, zonedToDate } from "./time";
import { syncTrial } from "./probation";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Admin chấm hộ / sửa giờ / duyệt yêu cầu điều chỉnh: ghi lượt chấm công + tính lại muộn / sớm / giờ công. */
export async function upsertAttendance(
  admin: AdminSession,
  opts: {
    id?: string;
    userId: string;
    date: string;
    inTime: string;
    outTime: string;
    reason: string;
    source: "ADMIN_MANUAL" | "REQUEST";
    /** sửa giờ: ghi chú hiện cho nhân viên (trống = giữ ghi chú cũ) */
    staffNote?: string;
    /** cơ sở làm việc (đi hỗ trợ). Bỏ trống → theo ca đã xếp, không có ca thì cơ sở gốc */
    workStoreId?: string;
    /** chấm hộ hàng loạt: không ghi nhật ký từng lượt (ghi 1 dòng tổng) */
    quiet?: boolean;
    /** ghi chú nội bộ khi TẠO lượt (VD "Excel F: 15h" khi import) */
    note?: string;
    /** giờ cộng thêm cho lượt này (VD 0,5) – undefined = giữ nguyên */
    extraHours?: number;
    /** import dữ liệu cũ: thiếu giờ ra ở ngày đã qua → ghi "Quên check-out" (không phải đang trong ca) */
    pastMissingOut?: boolean;
  },
) {
  const user = await User.findById(opts.userId).lean();
  if (!user?.storeId) throw new Error("Nhân viên chưa thuộc cơ sở nào");
  if (!DATE_RE.test(opts.date)) throw new Error("Ngày không hợp lệ");
  if (opts.inTime && !TIME_RE.test(opts.inTime.slice(0, 5))) throw new Error("Giờ vào không hợp lệ");
  if (opts.outTime && !TIME_RE.test(opts.outTime.slice(0, 5))) throw new Error("Giờ ra không hợp lệ");
  // sửa giờ: ghi chú không bắt buộc · chấm hộ / tạo mới: bắt buộc lý do
  if (!opts.id && opts.reason.length < 3) throw new Error("Bắt buộc nhập lý do");

  const existing = opts.id ? await Attendance.findById(opts.id) : null;
  // không bao giờ chuyển lượt chấm công của người này sang người khác
  if (existing && String(existing.userId) !== String(opts.userId)) throw new Error("Lượt chấm công không thuộc nhân viên này");
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
  // giờ ra chưa tới (VD 9h chấm hộ ca 8h–13h, lấy giờ theo ca) → nhân viên đang trong ca:
  // chỉ ghi check-in lúc 8h, nhân viên tự bấm CHECK-OUT khi về (không ghi trước giờ ra 13h)
  if (checkOutAt && checkOutAt.getTime() > Date.now() + 60_000) checkOutAt = null;
  if (checkInAt.getTime() > Date.now() + 5 * 60_000 && !checkOutAt) throw new Error("Giờ vào chưa tới – chưa chấm hộ trước được");

  const month = localMonth(checkInAt, tz);
  await assertNotLocked(homeStoreId, month, opts.userId); // khoá theo bảng lương cơ sở gốc
  if (existing && existing.month !== month) await assertNotLocked(homeStoreId, existing.month, opts.userId);

  // luôn tìm lại ca theo giờ vào mới (sửa ngày/giờ thì ca cũ có thể không còn đúng)
  const shift = await findShiftFor(opts.userId, checkInAt, tz, storeId);
  const shiftAssignmentId = shift?.a._id ?? null;
  const extraHours = opts.extraHours ?? existing?.extraHours ?? 0;
  const fields = await computeFields({ storeId, shiftAssignmentId, checkInAt, checkOutAt, extraHours, payFactor: existing?.payFactor });
  // chưa có giờ ra: lượt đang "quên check-out" mà admin chỉ sửa giờ vào / ghi chú / +0,5h → giữ "quên check-out" (không mở lại thành đang trong ca)
  const status = checkOutAt
    ? "COMPLETED"
    : existing?.status === "MISSING_CHECKOUT" || (opts.pastMissingOut && Date.now() - checkInAt.getTime() > 16 * 3600_000)
      ? "MISSING_CHECKOUT"
      : "OPEN";
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
    extraHours,
    outOfShift: !shift,
    ...(checkOutAt ? {} : { totalHours: null, roundedHours: null, earlyMinutes: 0 }),
  };
  const actor = adminActor(admin);
  if (existing) {
    const before = existing.toObject();
    existing.set({
      ...set,
      note: [existing.note, `Sửa bởi ${admin.name}${opts.reason ? `: ${opts.reason}` : ""}`].filter(Boolean).join(" | "),
      ...(opts.staffNote ? { staffNote: opts.staffNote.slice(0, 300) } : {}),
    });
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
    if (user.probation) await syncTrial(user._id).catch((e: Error) => console.error("[trial]", e.message)); // 3 ca thử việc
    return existing;
  }
  const created = await Attendance.create({
    ...set,
    source: opts.source,
    ...(opts.note ? { note: opts.note } : {}),
    createdByAdminName: actor.name,
    manualReason: opts.reason,
  });
  await AttendanceAdjustment.create({ attendanceId: created._id, adminName: actor.name, action: "CREATE", after: { checkInAt, checkOutAt }, reason: opts.reason });
  if (!opts.quiet) await audit(actor, opts.source === "REQUEST" ? "attendance.request.create" : "attendance.manual", { type: "Attendance", id: String(created._id) }, null, {
    userId: opts.userId,
    checkInAt,
    checkOutAt,
    reason: opts.reason,
  });
  if (user.probation) await syncTrial(user._id).catch((e: Error) => console.error("[trial]", e.message)); // 3 ca thử việc
  return created;
}

