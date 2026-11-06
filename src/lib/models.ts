import mongoose, { Schema, model, models, type InferSchemaType, type Model, Types } from "mongoose";

/* Mỗi model = 1 collection MongoDB (spec mục 6.2). Tiền VND lưu số nguyên. Thời gian lưu UTC. */

function getModel<T>(name: string, schema: Schema<T>): Model<T> {
  return (models[name] as Model<T>) || model<T>(name, schema);
}

/* ---------- Settings (1 document) ---------- */
const SettingsSchema = new Schema(
  {
    key: { type: String, default: "main", unique: true },
    adminPasswordHash: { type: String, default: "" },
    adminPasswordChangedAt: Date,
    adminSessionVersion: { type: Number, default: 1 },
    googleRefreshTokenEnc: { type: String, default: "" },
    googleAccountEmail: { type: String, default: "" },
    googleConnectedAt: Date,
    rootDriveFolderId: { type: String, default: "" },
    roundStepHours: { type: Number, default: 0.5 },
    roundGraceMinutes: { type: Number, default: 0 },
    lateThresholdMinutes: { type: Number, default: 5 },
    earlyThresholdMinutes: { type: Number, default: 5 },
    minCheckoutMinutes: { type: Number, default: 5 },
    missingCheckoutHours: { type: Number, default: 16 },
    maxDevicesPerUser: { type: Number, default: 1 },
    faceMatchThreshold: { type: Number, default: 0.5 },
    maxGpsAccuracyM: { type: Number, default: 100 },
    adminSessionDays: { type: Number, default: 7 },
  },
  { timestamps: true },
);
export type SettingsDoc = InferSchemaType<typeof SettingsSchema>;
export const Settings = getModel("Settings", SettingsSchema);

/* ---------- Store ---------- */
const StoreSchema = new Schema(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    address: { type: String, default: "" },
    lat: Number,
    lng: Number,
    radiusM: { type: Number, default: 100 },
    timezone: { type: String, default: "Asia/Ho_Chi_Minh" },
    driveFolderId: { type: String, default: "" },
    telegramChatId: { type: String, default: "" }, // nhóm Telegram nhận ảnh chốt ca (trống → dùng TELEGRAM_CHAT_ID)
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type StoreDoc = InferSchemaType<typeof StoreSchema> & { _id: Types.ObjectId };
export const Store = getModel("Store", StoreSchema);

/* ---------- User (nhân viên) ---------- */
export const USER_STATUS = ["NEW", "PENDING", "ACTIVE", "REJECTED", "INACTIVE"] as const;
const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    googleName: String,
    avatar: String,
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    bankName: { type: String, default: "" },
    bankAccountEnc: { type: String, default: "" }, // STK mã hoá AES
    hourlyWage: { type: Number, default: 0 },
    status: { type: String, enum: USER_STATUS, default: "NEW" },
    rejectReason: String,
    storeId: { type: Schema.Types.ObjectId, ref: "Store" },
    joinedAt: Date,
    registeredAt: Date,
    consentFaceAt: Date,
  },
  { timestamps: true },
);
export type UserDoc = InferSchemaType<typeof UserSchema> & { _id: Types.ObjectId };
export const User = getModel("User", UserSchema);

/* ---------- FaceProfile ---------- */
const FaceProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    descriptor: { type: [Number], required: true },
    imageDriveId: String,
    pendingPhotoId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" },
  },
  { timestamps: true },
);
export const FaceProfile = getModel("FaceProfile", FaceProfileSchema);

/* ---------- Device ---------- */
const DeviceSchema = new Schema(
  {
    deviceId: { type: String, required: true, unique: true }, // 1 thiết bị chỉ thuộc 1 user
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    fingerprintHash: String,
    userAgent: String,
    os: String,
    browser: String,
    model: String,
    status: { type: String, enum: ["PENDING", "APPROVED", "REVOKED", "REJECTED"], default: "PENDING" },
    possibleOldDeviceId: String, // gợi ý: fingerprint trùng thiết bị cũ
    requestedAt: Date, // nhân viên bấm "Yêu cầu đổi thiết bị"
    approvedBy: String,
    approvedAt: Date,
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
export type DeviceDoc = InferSchemaType<typeof DeviceSchema> & { _id: Types.ObjectId };
export const Device = getModel("Device", DeviceSchema);

/* ---------- LoginLog (nhân viên) ---------- */
const LoginLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  deviceId: String,
  fingerprintHash: String,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now, index: true },
});
export const LoginLog = getModel("LoginLog", LoginLogSchema);

/* ---------- Shift ---------- */
const ShiftTemplateSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true, index: true },
    name: { type: String, required: true },
    startTime: { type: String, required: true }, // HH:mm
    endTime: { type: String, required: true }, // HH:mm (nhỏ hơn start → qua đêm)
    minStaff: { type: Number, default: 0 }, // tối thiểu – dưới mức này cảnh báo "Thiếu người"
    targetStaff: { type: Number, default: 0 }, // định mức – dưới mức này cảnh báo "Ít người"; xếp tự động lấp tới mức này
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export type ShiftTemplateDoc = InferSchemaType<typeof ShiftTemplateSchema> & { _id: Types.ObjectId };
export const ShiftTemplate = getModel("ShiftTemplate", ShiftTemplateSchema);

const ShiftAssignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    shiftTemplateId: { type: Schema.Types.ObjectId, ref: "ShiftTemplate", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    // snapshot giờ ca tại thời điểm xếp
    startTime: String,
    endTime: String,
    shiftName: String,
    // PENDING = nhân viên đăng ký, chờ duyệt · APPROVED = ca chính thức · REJECTED = bị từ chối
    // (bản ghi cũ không có status được coi là APPROVED)
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "APPROVED" },
    source: { type: String, enum: ["REQUEST", "MANUAL", "AUTO", "BULK"], default: "MANUAL" },
    decidedBy: String,
    decidedAt: Date,
  },
  { timestamps: true },
);
ShiftAssignmentSchema.index({ userId: 1, date: 1 });
ShiftAssignmentSchema.index({ storeId: 1, date: 1 });
ShiftAssignmentSchema.index({ storeId: 1, status: 1, date: 1 });
ShiftAssignmentSchema.index({ userId: 1, date: 1, shiftTemplateId: 1 }, { unique: true });
export type ShiftAssignmentDoc = InferSchemaType<typeof ShiftAssignmentSchema> & { _id: Types.ObjectId };
export const ShiftAssignment = getModel("ShiftAssignment", ShiftAssignmentSchema);
/** Điều kiện lọc ca chính thức (đã duyệt) – dùng cho chấm công, dashboard, xuất Excel. */
export const APPROVED_SHIFT = { status: { $nin: ["PENDING", "REJECTED"] } } as const;

/* ---------- Attendance (bảng chấm công) ---------- */
const AttendanceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true }, // cơ sở làm việc thực tế
    // cơ sở gốc của nhân viên (trả lương). Khác storeId = đi HỖ TRỢ cơ sở khác. Bản ghi cũ không có → = storeId
    homeStoreId: { type: Schema.Types.ObjectId, ref: "Store" },
    workDate: { type: String, required: true }, // YYYY-MM-DD theo giờ cơ sở (ngày check-in)
    month: { type: String, required: true }, // YYYY-MM
    shiftAssignmentId: { type: Schema.Types.ObjectId, ref: "ShiftAssignment" },
    shiftLabel: String,
    checkInAt: { type: Date, required: true },
    checkOutAt: Date,
    checkInLat: Number,
    checkInLng: Number,
    checkOutLat: Number,
    checkOutLng: Number,
    checkInDistanceM: Number,
    checkOutDistanceM: Number,
    checkInPhotoId: String, // Drive fileId
    checkOutPhotoId: String,
    checkInPendingPhotoId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" },
    checkOutPendingPhotoId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" },
    checkInDeviceId: String,
    checkOutDeviceId: String,
    faceScoreIn: Number,
    faceScoreOut: Number,
    totalHours: Number,
    roundedHours: Number,
    lateMinutes: { type: Number, default: 0 },
    earlyMinutes: { type: Number, default: 0 },
    outOfShift: { type: Boolean, default: false },
    source: { type: String, enum: ["SELF", "ADMIN_MANUAL", "REQUEST"], default: "SELF" },
    createdByAdminName: String,
    manualReason: String,
    status: { type: String, enum: ["OPEN", "COMPLETED", "MISSING_CHECKOUT"], default: "OPEN" },
    note: String,
  },
  { timestamps: true },
);
AttendanceSchema.index({ userId: 1, checkInAt: -1 });
AttendanceSchema.index({ storeId: 1, month: 1 });
AttendanceSchema.index({ homeStoreId: 1, month: 1 });
AttendanceSchema.index({ userId: 1, month: 1 });
// Mỗi nhân viên chỉ có 1 lượt đang mở → chống chấm trùng / ghi đồng thời
AttendanceSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: "OPEN" }, name: "one_open_per_user" });
export type AttendanceDoc = InferSchemaType<typeof AttendanceSchema> & { _id: Types.ObjectId };
export const Attendance = getModel("Attendance", AttendanceSchema);

const AttendanceAdjustmentSchema = new Schema({
  attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance", index: true },
  adminName: String,
  action: String, // CREATE | UPDATE | DELETE
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  reason: String,
  createdAt: { type: Date, default: Date.now },
});
export const AttendanceAdjustment = getModel("AttendanceAdjustment", AttendanceAdjustmentSchema);

/* ---------- Yêu cầu điều chỉnh chấm công (nhân viên gửi) ---------- */
const AdjustmentRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance" },
    workDate: String,
    checkInTime: String, // HH:mm
    checkOutTime: String,
    reason: { type: String, required: true },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED"], default: "PENDING" },
    adminName: String,
    adminReply: String,
    resolvedAt: Date,
  },
  { timestamps: true },
);
export const AdjustmentRequest = getModel("AdjustmentRequest", AdjustmentRequestSchema);

/* ---------- Chốt ca: ảnh chụp cuối ca → gửi nhóm Telegram ---------- */
const ShiftClosingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance" },
    workDate: { type: String, required: true },
    shiftLabel: String,
    // thông tin ca đang chốt (snapshot lúc chốt)
    shiftAssignmentId: { type: Schema.Types.ObjectId, ref: "ShiftAssignment" },
    shiftName: String,
    shiftStart: String, // HH:mm
    shiftEnd: String,
    checkInAt: Date,
    checkOutAt: Date,
    coworkers: [String], // những người cùng ca (đã duyệt)
    employeeName: String,
    employeePhone: String,
    note: String,
    lat: Number,
    lng: Number,
    distanceM: Number,
    deviceId: String,
    photos: [{ driveId: String, pendingId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" } }],
    telegram: {
      status: { type: String, enum: ["PENDING", "SENT", "FAILED", "DISABLED"], default: "PENDING" },
      chatId: String,
      messageIds: [Number],
      error: String,
      attempts: { type: Number, default: 0 },
      sentAt: Date,
    },
    webhook: { status: String, error: String },
  },
  { timestamps: true },
);
ShiftClosingSchema.index({ storeId: 1, createdAt: -1 });
ShiftClosingSchema.index({ "telegram.status": 1 });
export const ShiftClosing = getModel("ShiftClosing", ShiftClosingSchema);

/* ---------- Ảnh chờ upload Drive (khi mất kết nối) ---------- */
const PendingPhotoSchema = new Schema({
  data: { type: Buffer, required: true },
  mimeType: { type: String, default: "image/jpeg" },
  fileName: String,
  folderName: String,
  storeId: { type: Schema.Types.ObjectId, ref: "Store" },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  month: String,
  target: String, // "attendance:<id>:in" | "attendance:<id>:out" | "face:<userId>"
  attempts: { type: Number, default: 0 },
  lastError: String,
  createdAt: { type: Date, default: Date.now },
});
export const PendingPhoto = getModel("PendingPhoto", PendingPhotoSchema);

/* ---------- Lương ---------- */
const WageHistorySchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  hourlyWage: { type: Number, required: true },
  effectiveFrom: { type: String, required: true }, // YYYY-MM-DD
  createdBy: String,
  createdAt: { type: Date, default: Date.now },
});
export const WageHistory = getModel("WageHistory", WageHistorySchema);

const BonusPenaltySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    kind: { type: String, enum: ["BONUS", "PENALTY"], required: true },
    attendanceId: { type: Schema.Types.ObjectId, ref: "Attendance" },
    date: { type: String, required: true }, // YYYY-MM-DD
    month: { type: String, required: true },
    amountVnd: { type: Number, required: true },
    content: { type: String, required: true },
    createdBy: String,
  },
  { timestamps: true },
);
BonusPenaltySchema.index({ userId: 1, date: 1 });
BonusPenaltySchema.index({ storeId: 1, month: 1 });
export const BonusPenalty = getModel("BonusPenalty", BonusPenaltySchema);

const PayrollSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    month: { type: String, required: true },
    status: { type: String, enum: ["DRAFT", "PUBLISHED", "PAID"], default: "DRAFT" },
    publishedAt: Date,
    publishedBy: String,
    paidAt: Date,
    calculatedAt: Date,
    unlockedAt: Date, // admin mở khoá → cron ngày 5 không tự công bố lại
  },
  { timestamps: true },
);
PayrollSchema.index({ storeId: 1, month: 1 }, { unique: true });
export const Payroll = getModel("Payroll", PayrollSchema);

const PayrollItemSchema = new Schema(
  {
    payrollId: { type: Schema.Types.ObjectId, ref: "Payroll", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    month: { type: String, required: true },
    totalHours: { type: Number, default: 0 },
    workDays: { type: Number, default: 0 },
    hourlyWage: { type: Number, default: 0 }, // lương giờ hiện hành (hiển thị)
    basePay: { type: Number, default: 0 },
    allowance: { type: Number, default: 0 },
    totalBonus: { type: Number, default: 0 },
    totalPenalty: { type: Number, default: 0 },
    advance: { type: Number, default: 0 },
    netPay: { type: Number, default: 0 },
    lateCount: { type: Number, default: 0 },
    earlyCount: { type: Number, default: 0 },
    supportHours: { type: Number, default: 0 }, // trong tổng giờ: số giờ đi hỗ trợ cơ sở khác
    supportNote: String, // VD "TBS Văn Phú 8h"
  },
  { timestamps: true },
);
PayrollItemSchema.index({ payrollId: 1, userId: 1 }, { unique: true });
export const PayrollItem = getModel("PayrollItem", PayrollItemSchema);

const PayrollFeedbackSchema = new Schema(
  {
    payrollItemId: { type: Schema.Types.ObjectId, ref: "PayrollItem", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store" },
    month: String,
    content: { type: String, required: true },
    status: { type: String, enum: ["OPEN", "RESOLVED"], default: "OPEN" },
    adminReply: String,
    adminName: String,
  },
  { timestamps: true },
);
export const PayrollFeedback = getModel("PayrollFeedback", PayrollFeedbackSchema);

/* ---------- Admin login log & Audit ---------- */
const AdminLoginLogSchema = new Schema({
  kind: { type: String, enum: ["OWNER", "PASSWORD"] },
  displayName: String,
  success: Boolean,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now, index: true },
});
export const AdminLoginLog = getModel("AdminLoginLog", AdminLoginLogSchema);

const AuditLogSchema = new Schema({
  actorKind: { type: String, enum: ["OWNER", "ADMIN", "USER", "SYSTEM"] },
  actorName: String,
  action: { type: String, index: true },
  targetType: String,
  targetId: String,
  before: Schema.Types.Mixed,
  after: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now, index: true },
});
export const AuditLog = getModel("AuditLog", AuditLogSchema);

export { mongoose };
