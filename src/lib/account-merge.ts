import { Types } from "mongoose";
import { connectDB } from "./db";
import {
  AdjustmentRequest,
  AdminActivity,
  Attendance,
  AttendanceArchive,
  AuditLog,
  BonusPenalty,
  CoverRequest,
  Device,
  FaceProfile,
  LoginLog,
  PayrollFeedback,
  PayrollItem,
  PendingPhoto,
  ShiftAssignment,
  ShiftClosing,
  ShiftRegRequest,
  User,
  UserNotice,
  WageHistory,
  SalaryHistory,
} from "./models";

/*
 * Chuyển tài khoản nhân viên: nhân viên đăng nhập bằng Gmail mới → admin chuyển TOÀN BỘ dữ liệu
 * của tài khoản (Gmail) cũ sang tài khoản mới rồi xoá tài khoản cũ.
 * Không dùng transaction (Mongo có thể chạy standalone) → kiểm tra xung đột trước, ghi sau;
 * lỗi giữa chừng thì tài khoản cũ vẫn còn → chạy lại sẽ chuyển nốt phần còn lại.
 */

/** Hồ sơ lấy từ tài khoản cũ (tài khoản mới chỉ giữ email / tên Google / ảnh đại diện). */
const PROFILE_FIELDS = ["name", "phone", "bankName", "bankAccountEnc", "hourlyWage", "payType", "monthlySalary", "status", "storeId", "joinedAt", "firstWorkDate", "registeredAt", "consentFaceAt", "managerPerms", "managerStoreIds"] as const;

export type MergePreview = {
  counts: Record<string, number>;
  /** chặn chuyển (phải xử lý trước) */
  blockers: string[];
  /** sẽ bỏ bản trùng của tài khoản cũ */
  notes: string[];
};

const oid = (id: string) => {
  if (!Types.ObjectId.isValid(id)) throw new Error("Mã tài khoản không hợp lệ");
  return new Types.ObjectId(id);
};

async function load(fromId: string, toId: string) {
  await connectDB();
  if (fromId === toId) throw new Error("Tài khoản cũ và mới trùng nhau");
  const [from, to] = await Promise.all([User.findById(oid(fromId)), User.findById(oid(toId))]);
  if (!from) throw new Error("Không tìm thấy tài khoản cũ");
  if (!to) throw new Error("Không tìm thấy tài khoản mới");
  return { from, to };
}

/** Đếm dữ liệu sẽ chuyển + phát hiện xung đột. */
export async function previewMerge(fromId: string, toId: string): Promise<MergePreview> {
  const { from, to } = await load(fromId, toId);
  const f = from._id;
  const t = to._id;
  const [att, open, assign, reg, closing, adj, cover, notice, wage, bp, item, fb, dev, face, login] = await Promise.all([
    Attendance.countDocuments({ userId: f }),
    Promise.all([Attendance.exists({ userId: f, status: "OPEN" }), Attendance.exists({ userId: t, status: "OPEN" })]),
    ShiftAssignment.countDocuments({ userId: f }),
    ShiftRegRequest.countDocuments({ userId: f }),
    ShiftClosing.countDocuments({ userId: f }),
    AdjustmentRequest.countDocuments({ userId: f }),
    CoverRequest.countDocuments({ $or: [{ fromUserId: f }, { toUserId: f }] }),
    UserNotice.countDocuments({ userId: f }),
    WageHistory.countDocuments({ userId: f }),
    BonusPenalty.countDocuments({ userId: f }),
    PayrollItem.find({ userId: f }).select("payrollId").lean(),
    PayrollFeedback.countDocuments({ userId: f }),
    Device.countDocuments({ userId: f }),
    Promise.all([FaceProfile.exists({ userId: f }), FaceProfile.exists({ userId: t })]),
    LoginLog.countDocuments({ userId: f }),
  ]);
  const blockers: string[] = [];
  const notes: string[] = [];
  if (open[0] && open[1]) blockers.push("Cả 2 tài khoản đều đang trong ca (chưa check-out) – check-out 1 lượt trước khi chuyển");
  const clashPayroll = item.length ? await PayrollItem.countDocuments({ userId: t, payrollId: { $in: item.map((i) => i.payrollId) } }) : 0;
  if (clashPayroll) blockers.push(`Tài khoản mới đã có ${clashPayroll} dòng trong bảng lương mà tài khoản cũ cũng có – xoá dòng lương của tài khoản mới trước`);
  if (face[0] && face[1]) notes.push("Cả 2 đều có ảnh khuôn mặt mẫu – giữ ảnh của tài khoản MỚI (mới chụp hơn), bỏ ảnh cũ");
  return {
    counts: {
      "Lượt chấm công": att,
      "Ca được xếp": assign,
      "Đăng ký ca": reg,
      "Chốt ca": closing,
      "Yêu cầu sửa công": adj,
      "Nhờ / nhận làm thay": cover,
      "Thông báo": notice,
      "Lịch sử lương giờ": wage,
      "Thưởng / phạt": bp,
      "Dòng bảng lương": item.length,
      "Phản hồi bảng lương": fb,
      "Thiết bị": dev,
      "Ảnh khuôn mặt mẫu": face[0] ? 1 : 0,
      "Lịch sử đăng nhập": login,
    },
    blockers,
    notes,
  };
}

/** Chuyển dữ liệu từ tài khoản cũ → mới, chép hồ sơ, rồi xoá tài khoản cũ. */
export async function mergeUserAccount(fromId: string, toId: string) {
  const pv = await previewMerge(fromId, toId);
  if (pv.blockers.length) throw new Error(pv.blockers.join(" · "));
  const { from, to } = await load(fromId, toId);
  const f = from._id;
  const t = to._id;
  const fromEmail = from.email;

  // 1) bảng có khoá duy nhất theo userId → bỏ bản của tài khoản cũ nếu tài khoản mới đã có
  const dupAssign = await ShiftAssignment.find({ userId: f }).select("date shiftTemplateId").lean();
  for (const a of dupAssign)
    if (await ShiftAssignment.exists({ userId: t, date: a.date, shiftTemplateId: a.shiftTemplateId })) await ShiftAssignment.deleteOne({ _id: a._id });
  const dupReg = await ShiftRegRequest.find({ userId: f }).select("weekStart").lean();
  for (const r of dupReg) if (await ShiftRegRequest.exists({ userId: t, weekStart: r.weekStart })) await ShiftRegRequest.deleteOne({ _id: r._id });
  if (await FaceProfile.exists({ userId: t })) await FaceProfile.deleteMany({ userId: f });

  // 2) chuyển chủ sở hữu
  const set = { $set: { userId: t } };
  const moved: Record<string, number> = {};
  const run = async (name: string, p: Promise<{ modifiedCount: number }>) => (moved[name] = (await p).modifiedCount);
  await run("attendance", Attendance.updateMany({ userId: f }, set));
  await run("attendanceArchive", AttendanceArchive.updateMany({ userId: f }, set));
  await run("assignment", ShiftAssignment.updateMany({ userId: f }, set));
  await run("shiftReg", ShiftRegRequest.updateMany({ userId: f }, set));
  await run("closing", ShiftClosing.updateMany({ userId: f }, set));
  await run("adjustment", AdjustmentRequest.updateMany({ userId: f }, set));
  await run("coverFrom", CoverRequest.updateMany({ fromUserId: f }, { $set: { fromUserId: t } }));
  await run("coverTo", CoverRequest.updateMany({ toUserId: f }, { $set: { toUserId: t } }));
  await run("notice", UserNotice.updateMany({ userId: f }, set));
  await run("wage", WageHistory.updateMany({ userId: f }, set));
  await run("salary", SalaryHistory.updateMany({ userId: f }, set));
  await run("bonusPenalty", BonusPenalty.updateMany({ userId: f }, set));
  await run("bonusPenaltyCreator", BonusPenalty.updateMany({ createdByUserId: f }, { $set: { createdByUserId: t } }));
  await run("payrollItem", PayrollItem.updateMany({ userId: f }, set));
  await run("payrollFeedback", PayrollFeedback.updateMany({ userId: f }, set));
  await run("device", Device.updateMany({ userId: f }, set)); // điện thoại cũ đã duyệt → chấm công được ngay với Gmail mới
  await run("face", FaceProfile.updateMany({ userId: f }, set));
  await run("loginLog", LoginLog.updateMany({ userId: f }, set));
  await run("pendingPhoto", PendingPhoto.updateMany({ userId: f }, set));
  await PendingPhoto.updateMany({ target: `face:${fromId}` }, { $set: { target: `face:${toId}` } });
  await AuditLog.updateMany({ targetType: "User", targetId: fromId }, { $set: { targetId: toId } });
  await AdminActivity.updateMany({ targetType: "User", targetId: fromId }, { $set: { targetId: toId } });

  // 3) hồ sơ: lấy theo tài khoản cũ (chỉ ghi đè khi tài khoản cũ có giá trị)
  const patch: Record<string, unknown> = {};
  for (const k of PROFILE_FIELDS) {
    const v = from.get(k);
    if (v != null && v !== "") patch[k] = v;
  }
  // tài khoản mới đã duyệt thì giữ; còn lại theo trạng thái tài khoản cũ
  if (to.status === "ACTIVE") delete patch.status;
  to.set({ ...patch, rejectReason: undefined });
  await to.save();

  // 4) xoá tài khoản cũ
  await User.deleteOne({ _id: f });
  return { moved, fromEmail, toEmail: to.email };
}
