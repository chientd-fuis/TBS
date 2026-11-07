import { connectDB } from "./db";
import { AdminLoginLog, Attendance, AttendanceAdjustment, AuditLog, DayRevenue, LoginLog, PendingPhoto, ShiftClosing } from "./models";
import { DEFAULT_TZ, localMonth, prevMonth, zonedToDate } from "./time";
import { trashOldPhotoFolders } from "./drive";

/* Dọn dữ liệu cũ (chỉ Chủ): log đăng nhập, nhật ký thao tác, ảnh chấm công / chốt ca. KHÔNG xoá bản ghi chấm công, lương. */

export type CleanupOpts = {
  beforeMonth: string; // xoá dữ liệu của các tháng TRƯỚC tháng này (YYYY-MM)
  loginLogs: boolean; // lịch sử đăng nhập nhân viên + admin
  auditLogs: boolean; // nhật ký thao tác admin
  adjustLogs: boolean; // lịch sử sửa chấm công
  photos: boolean; // ảnh check-in/out + chốt ca (trong MongoDB + liên kết ảnh)
  drivePhotos: boolean; // chuyển cả thư mục ảnh tháng cũ trên Drive vào thùng rác
  closings?: boolean; // thông tin chốt ca (doanh thu từng ca, đã ghi tổng lên Google Sheet) + doanh thu ngày
};
export type CleanupCounts = {
  loginLogs: number;
  adminLoginLogs: number;
  auditLogs: number;
  adjustLogs: number;
  attendancePhotos: number;
  closingPhotos: number;
  pendingPhotos: number;
  closings?: number;
  dayRevenues?: number;
  unsyncedDays?: number; // ngày chưa ghi được Google Sheet (cảnh báo trước khi xoá)
  driveFolders?: number;
  driveRemaining?: number;
};

/** Tháng mới nhất được phép chọn: giữ lại tháng hiện tại + 2 tháng trước. */
export function latestCutoff(now = new Date()) {
  return prevMonth(prevMonth(localMonth(now, DEFAULT_TZ)));
}

function validate(o: CleanupOpts) {
  if (!/^\d{4}-\d{2}$/.test(o.beforeMonth)) throw new Error("Tháng không hợp lệ");
  if (o.beforeMonth > latestCutoff()) throw new Error("Chỉ xoá được dữ liệu cũ hơn 2 tháng (giữ tháng này và 2 tháng trước)");
  if (!o.loginLogs && !o.auditLogs && !o.adjustLogs && !o.photos && !o.closings) throw new Error("Chọn ít nhất 1 loại dữ liệu");
}

function filters(o: CleanupOpts) {
  const cutoff = zonedToDate(`${o.beforeMonth}-01`, "00:00", DEFAULT_TZ);
  return {
    byDate: { createdAt: { $lt: cutoff } },
    att: {
      month: { $lt: o.beforeMonth },
      $or: [
        { checkInPhotoId: { $nin: [null, ""] } },
        { checkOutPhotoId: { $nin: [null, ""] } },
        { checkInPendingPhotoId: { $ne: null } },
        { checkOutPendingPhotoId: { $ne: null } },
      ],
    },
    closing: { workDate: { $lt: `${o.beforeMonth}-01` }, "photos.0": { $exists: true } },
    closingAll: { workDate: { $lt: `${o.beforeMonth}-01` } },
    days: { date: { $lt: `${o.beforeMonth}-01` } },
  };
}

export async function previewCleanup(o: CleanupOpts): Promise<CleanupCounts> {
  validate(o);
  await connectDB();
  const f = filters(o);
  const n = (on: boolean, p: Promise<number>) => (on ? p : Promise.resolve(0));
  const [loginLogs, adminLoginLogs, auditLogs, adjustLogs, attendancePhotos, closingPhotos, pendingPhotos] = await Promise.all([
    n(o.loginLogs, LoginLog.countDocuments(f.byDate)),
    n(o.loginLogs, AdminLoginLog.countDocuments(f.byDate)),
    n(o.auditLogs, AuditLog.countDocuments(f.byDate)),
    n(o.adjustLogs, AttendanceAdjustment.countDocuments(f.byDate)),
    n(o.photos, Attendance.countDocuments(f.att)),
    n(o.photos, ShiftClosing.countDocuments(f.closing)),
    n(o.photos, PendingPhoto.countDocuments(f.byDate)),
  ]);
  const out: CleanupCounts = { loginLogs, adminLoginLogs, auditLogs, adjustLogs, attendancePhotos, closingPhotos, pendingPhotos };
  if (o.closings) {
    out.closings = await ShiftClosing.countDocuments(f.closingAll);
    out.dayRevenues = await DayRevenue.countDocuments(f.days);
    out.unsyncedDays = await DayRevenue.countDocuments({ ...f.days, "sheet.status": { $ne: "SENT" } });
  }
  return out;
}

export async function runCleanup(o: CleanupOpts, budgetMs = 45_000): Promise<CleanupCounts> {
  validate(o);
  await connectDB();
  const deadline = Date.now() + budgetMs;
  const f = filters(o);
  const out: CleanupCounts = { loginLogs: 0, adminLoginLogs: 0, auditLogs: 0, adjustLogs: 0, attendancePhotos: 0, closingPhotos: 0, pendingPhotos: 0 };

  if (o.photos && o.drivePhotos) {
    const r = await trashOldPhotoFolders(o.beforeMonth, deadline - 5_000);
    out.driveFolders = r.trashed;
    out.driveRemaining = r.remaining;
  }
  if (o.loginLogs) {
    out.loginLogs = (await LoginLog.deleteMany(f.byDate)).deletedCount ?? 0;
    out.adminLoginLogs = (await AdminLoginLog.deleteMany(f.byDate)).deletedCount ?? 0;
  }
  if (o.auditLogs) out.auditLogs = (await AuditLog.deleteMany(f.byDate)).deletedCount ?? 0;
  if (o.adjustLogs) out.adjustLogs = (await AttendanceAdjustment.deleteMany(f.byDate)).deletedCount ?? 0;
  if (o.photos) {
    const now = new Date();
    out.attendancePhotos = (
      await Attendance.updateMany(f.att, {
        $unset: { checkInPhotoId: 1, checkOutPhotoId: 1, checkInPendingPhotoId: 1, checkOutPendingPhotoId: 1 },
        $set: { photosPurgedAt: now },
      })
    ).modifiedCount;
    out.closingPhotos = (await ShiftClosing.updateMany(f.closing, { $set: { photos: [], photosPurgedAt: now } })).modifiedCount;
    out.pendingPhotos = (await PendingPhoto.deleteMany(f.byDate)).deletedCount ?? 0;
  }
  if (o.closings) {
    out.closings = (await ShiftClosing.deleteMany(f.closingAll)).deletedCount ?? 0;
    out.dayRevenues = (await DayRevenue.deleteMany(f.days)).deletedCount ?? 0;
  }
  return out;
}
