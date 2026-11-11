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
    roundGraceMinutes: { type: Number, default: 0 }, // dung sai lên mốc lẻ (VD :30)
    roundGraceHourMinutes: { type: Number }, // dung sai lên mốc tròn giờ (:00) – trống = dùng roundGraceMinutes
    lateThresholdMinutes: { type: Number, default: 5 },
    earlyThresholdMinutes: { type: Number, default: 5 },
    minCheckoutMinutes: { type: Number, default: 5 },
    missingCheckoutHours: { type: Number, default: 16 },
    maxDevicesPerUser: { type: Number, default: 1 },
    faceMatchThreshold: { type: Number, default: 0.5 },
    maxGpsAccuracyM: { type: Number, default: 100 },
    adminSessionDays: { type: Number, default: 7 },
    // Tài chính: nhóm Telegram "Quản lý doanh thu" (ảnh bill chi phí + báo cáo) – trống → TELEGRAM_FINANCE_CHAT_ID
    financeChatId: { type: String, default: "" },
    financeReportDaily: { type: Boolean, default: true },
    financeReportWeekly: { type: Boolean, default: true },
    financeReportMonthly: { type: Boolean, default: true },
    financeAiComment: { type: Boolean, default: true }, // Gemini viết nhận xét trong báo cáo
    // Cài đặt AI (lib/ai.ts): bật/tắt + giới hạn từng chức năng, ngân sách token, nội dung Trợ lý cửa hàng
    ai: { type: Schema.Types.Mixed, default: {} },
    autoCleanup: { type: Boolean, default: false }, // tự dọn dữ liệu rác mỗi tháng (cron)
    // Nhận hàng: danh mục nguyên liệu dạng chữ (lib/goods.ts) – trống → danh mục mặc định
    goodsCatalog: { type: String, default: "" },
    goodsEnabled: { type: Boolean, default: true }, // Admin Tổng bật / tắt cả chức năng Nhận hàng
    stockEnabled: { type: Boolean, default: false }, // Tồn kho (kiểm kho) – mặc định tắt
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
    // cách xác thực khi chấm công (bật nhiều → phải qua tất cả) – xem lib/checkin-methods.ts
    checkFace: { type: Boolean, default: true }, // chụp ảnh khuôn mặt
    checkGps: { type: Boolean, default: true }, // vị trí trong bán kính
    checkWifi: { type: Boolean, default: false }, // phải dùng WiFi quán (so IP Internet của quán)
    wifiName: { type: String, default: "" }, // tên WiFi hiển thị cho nhân viên
    wifiIps: { type: [String], default: [] }, // IP public của WiFi quán (IPv4 / dải IPv6 /64)
    timezone: { type: String, default: "Asia/Ho_Chi_Minh" },
    driveFolderId: { type: String, default: "" },
    telegramChatId: { type: String, default: "" }, // nhóm Telegram nhận ảnh chốt ca (trống → dùng TELEGRAM_CHAT_ID)
    telegramGoodsChatId: { type: String, default: "" }, // nhóm nhận hàng / tồn kho (trống → TELEGRAM_GOODS_CHAT_ID → nhóm chốt ca)
    telegramAttendanceChatId: { type: String, default: "" }, // nhóm chấm công: báo check-in/out (trống → TELEGRAM_ATTENDANCE_CHAT_ID)
    // Google Sheet doanh thu (template: Ngày | DT | Tài khoản | Tiền mặt | CP trong két | Shopee | Chênh lệch | DT thực tế | Ghi chú)
    revenueSheetId: { type: String, default: "" },
    revenueTabPattern: { type: String, default: "T{m}" }, // tên tab theo tháng: {m} {mm} {yyyy}
    revenueFirstRow: { type: Number, default: 3 }, // dòng của ngày 1
    // mẫu cột: GRAB_COL (B–G + ghi chú J, mặc định cơ sở mới) | LEGACY (B–F, Grab gộp Shopee, ghi chú I)
    revenueSheetLayout: { type: String, enum: ["GRAB_COL", "LEGACY"], default: "GRAB_COL" },
    // % phí sàn trừ vào doanh thu khi tính lãi lỗ
    grabFeePct: { type: Number, default: 0 },
    shopeeFeePct: { type: Number, default: 0 },
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
    // quyền quản lý admin cấp cho nhân viên (lib/permissions.ts): schedule | bonus | cover
    // nhân viên admin tự tạo, không có Gmail đăng nhập (VD đã nghỉ việc – để nhập chấm công / tính lương tháng cũ)
    noLogin: { type: Boolean, default: false },
    managerPerms: { type: [String], default: [] },
    managerStoreIds: { type: [Schema.Types.ObjectId], default: [] }, // cơ sở được quản lý thêm (ngoài cơ sở gốc)
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
  createdAt: { type: Date, default: Date.now, expires: 180 * 86_400 }, // TTL: tự xoá sau 180 ngày
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
    // định mức riêng từng ngày (VD áp dụng gợi ý AI cho 1 tuần) – có thì thay targetStaff cho ngày đó
    staffByDate: { type: [{ date: String, target: Number, _id: false }], default: [] },
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

/* ---------- Yêu cầu đăng ký ca (admin nhắc nhân viên đăng ký ca cho 1 tuần) ---------- */
const ShiftRegRequestSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    weekStart: { type: String, required: true }, // YYYY-MM-DD (thứ 2)
    // OPEN = đang chờ nhân viên đăng ký · DONE = đã gửi đăng ký · OFF = nhân viên báo nghỉ cả tuần
    status: { type: String, enum: ["OPEN", "DONE", "OFF"], default: "OPEN" },
    requestedBy: String,
    requestedAt: { type: Date, default: Date.now },
    respondedAt: Date,
  },
  { timestamps: true },
);
ShiftRegRequestSchema.index({ userId: 1, weekStart: 1 }, { unique: true });
ShiftRegRequestSchema.index({ storeId: 1, weekStart: 1 });
export const ShiftRegRequest = getModel("ShiftRegRequest", ShiftRegRequestSchema);

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
    checkInIp: String,
    checkOutIp: String,
    checkInPhotoId: String, // Drive fileId
    checkOutPhotoId: String,
    checkInPendingPhotoId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" },
    checkOutPendingPhotoId: { type: Schema.Types.ObjectId, ref: "PendingPhoto" },
    checkInDeviceId: String,
    checkOutDeviceId: String,
    faceScoreIn: Number,
    faceScoreOut: Number,
    totalHours: Number,
    roundedHours: Number, // giờ tính công = làm tròn + extraHours
    extraHours: { type: Number, default: 0 }, // admin cộng thêm cho lượt này (VD +0,5h) – đã gồm trong roundedHours
    lateMinutes: { type: Number, default: 0 },
    earlyMinutes: { type: Number, default: 0 },
    outOfShift: { type: Boolean, default: false },
    source: { type: String, enum: ["SELF", "ADMIN_MANUAL", "REQUEST"], default: "SELF" },
    createdByAdminName: String,
    manualReason: String,
    status: { type: String, enum: ["OPEN", "COMPLETED", "MISSING_CHECKOUT"], default: "OPEN" },
    note: String, // ghi chú nội bộ (admin xem): "Sửa bởi …"
    staffNote: String, // ghi chú admin để lại cho nhân viên – hiện ở Lịch sử chấm công của nhân viên
    photosPurgedAt: Date, // ảnh check-in/out đã bị xoá khi dọn dữ liệu cũ
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
    lockedAt: Date, // đang được 1 admin xử lý – chống duyệt 2 lần (bấm đúp / 2 admin cùng bấm)
  },
  { timestamps: true },
);
export const AdjustmentRequest = getModel("AdjustmentRequest", AdjustmentRequestSchema);

/* ---------- Chốt ca: ảnh chụp cuối ca → gửi nhóm Telegram ---------- */
const ShiftClosingSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true }, // admin bổ sung chốt ca có thể không rõ người chốt
    addedByAdmin: String, // admin nhập bù ca còn thiếu (tên admin)
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
    photosPurgedAt: Date, // ảnh đã bị xoá khi dọn dữ liệu cũ
    telegram: {
      status: { type: String, enum: ["PENDING", "SENT", "FAILED", "DISABLED"], default: "PENDING" },
      chatId: String,
      messageIds: [Number],
      error: String,
      attempts: { type: Number, default: 0 },
      sentAt: Date,
    },
    webhook: { status: String, error: String },
    // doanh thu ca (nhân viên xác nhận / sửa sau khi bot đọc ảnh)
    revenue: { dt: Number, tm: Number, tk: Number, cp: Number, grab: Number, shopee: Number },
    // nội dung nhân viên gõ ở từng ô (VD thu chi "30k sữa chua + 20k ship") – hiển thị lại / gửi Telegram
    revenueInput: { dt: String, tm: String, tk: String, cp: String, grab: String, shopee: String },
    // số TỔNG nhân viên tự cộng ghi trên tờ chốt ca (để kiểm tra cộng đúng chưa = TM+TK+Thu chi+Grab+Shopee)
    staffTotal: Number,
    ocr: {
      status: { type: String, enum: ["NONE", "OK", "FAILED"], default: "NONE" },
      values: { dt: Number, tm: Number, tk: Number, cp: Number, grab: Number, shopee: Number }, // bot đọc được (để so với số nhân viên sửa)
      error: String,
    },
    isDayEnd: { type: Boolean, default: false }, // ca cuối ngày → ghi Google Sheet
    revenueEditedBy: String, // admin sửa số liệu
    revenueEditedByOwner: Boolean, // Admin Tổng sửa → admin khác không thấy nhãn "Admin sửa"
    editCount: { type: Number, default: 0 }, // số lần nhân viên chốt lại (cập nhật) ca này
    lastEditedAt: Date,
  },
  { timestamps: true },
);
ShiftClosingSchema.index({ storeId: 1, createdAt: -1 });
ShiftClosingSchema.index({ storeId: 1, workDate: 1, shiftName: 1 }); // 1 ca chỉ 1 bản ghi
ShiftClosingSchema.index({ "telegram.status": 1 });
/* ---------- Doanh thu theo ngày (cộng các lượt chốt ca) + trạng thái ghi Google Sheet ---------- */
const DayRevenueSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    date: { type: String, required: true }, // YYYY-MM-DD
    month: { type: String, required: true },
    dt: { type: Number, default: 0 },
    tk: { type: Number, default: 0 },
    tm: { type: Number, default: 0 },
    cp: { type: Number, default: 0 },
    grab: { type: Number, default: 0 },
    shopee: { type: Number, default: 0 },
    closings: { type: Number, default: 0 },
    lastShift: String, // ca quyết định doanh thu ngày (Tối; chưa chốt Tối → ca gần nhất)
    dtMissing: Boolean, // ca đó chưa có DT máy
    calcVersion: Number, // 2 = luỹ kế
    note: String,
    sheet: {
      status: { type: String, enum: ["PENDING", "SENT", "FAILED", "DISABLED"], default: "PENDING" },
      error: String,
      range: String,
      attempts: { type: Number, default: 0 },
      syncedAt: Date,
    },
  },
  { timestamps: true },
);
DayRevenueSchema.index({ storeId: 1, date: 1 }, { unique: true });
DayRevenueSchema.index({ "sheet.status": 1, date: 1 });
export const DayRevenue = getModel("DayRevenue", DayRevenueSchema);

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
/* ---------- Nhờ làm hộ ca (NV1 nhờ NV2 làm thay 1 ca đã duyệt) / Đổi ca (NV1 ↔ NV2) → admin duyệt → cập nhật lịch ---------- */
const CoverRequestSchema = new Schema(
  {
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    shiftAssignmentId: { type: Schema.Types.ObjectId, ref: "ShiftAssignment", required: true },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    date: { type: String, required: true },
    shiftName: String,
    startTime: String,
    endTime: String,
    /** COVER = nhờ làm hộ (ca của NV1 chuyển cho NV2) · SWAP = đổi ca (NV1 ↔ NV2, cả 2 đều có ca đã duyệt) */
    kind: { type: String, enum: ["COVER", "SWAP"], default: "COVER" },
    // đổi ca: ca của NV2 mà NV1 nhận về
    toShiftAssignmentId: { type: Schema.Types.ObjectId, ref: "ShiftAssignment" },
    toStoreId: { type: Schema.Types.ObjectId, ref: "Store" },
    toDate: String,
    toShiftName: String,
    toStartTime: String,
    toEndTime: String,
    note: String,
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING", index: true },
    decidedBy: String,
    decidedAt: Date,
    reply: String,
    lockedAt: Date, // đang được duyệt / từ chối – chống xử lý 2 lần (bấm đúp, Duyệt rồi Từ chối, 2 người cùng bấm)
  },
  { timestamps: true },
);
export const CoverRequest = getModel("CoverRequest", CoverRequestSchema);

/** Thông báo trong app cho nhân viên (hiện ở đầu mọi màn hình tới khi bấm "Đã xem"). */
const UserNoticeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, required: true },
    tone: { type: String, enum: ["green", "orange", "red", "blue"], default: "blue" },
    link: String,
    readAt: { type: Date, expires: 30 * 86_400 }, // TTL: đã đọc quá 30 ngày → tự xoá
  },
  { timestamps: true },
);
UserNoticeSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
export const UserNotice = getModel("UserNotice", UserNoticeSchema);

/* ---------- Nhận hàng: đồ / nguyên liệu các cơ sở nhận mỗi ngày ---------- */
const GoodsReceiptSchema = new Schema(
  {
    // RECEIVE = nhận hàng · STOCK = kiểm kho (số còn tồn cuối ngày)
    kind: { type: String, enum: ["RECEIVE", "STOCK"], default: "RECEIVE" },
    storeId: { type: Schema.Types.ObjectId, ref: "Store", required: true },
    date: { type: String, required: true }, // ngày nhận YYYY-MM-DD
    month: { type: String, required: true },
    items: { type: [{ _id: false, name: String, qty: Number, unit: String }], default: [] },
    note: String,
    raw: String, // nguyên văn tin nhắn / chữ gõ
    sender: String, // người báo trong ảnh nhóm chat
    source: { type: String, enum: ["TEXT", "PHOTO", "MANUAL"], default: "TEXT" },
    byUserId: { type: Schema.Types.ObjectId, ref: "User" },
    byName: String,
    byAdmin: { type: Boolean, default: false },
    telegram: { status: { type: String, enum: ["PENDING", "SENT", "FAILED", "DISABLED", "SKIPPED"], default: "PENDING" }, messageId: Number, error: String },
  },
  { timestamps: true },
);
GoodsReceiptSchema.index({ storeId: 1, date: -1 });
GoodsReceiptSchema.index({ kind: 1, storeId: 1, date: -1 });
GoodsReceiptSchema.index({ month: 1, date: -1 });
export type GoodsReceiptDoc = InferSchemaType<typeof GoodsReceiptSchema> & { _id: Types.ObjectId };
export const GoodsReceipt = getModel("GoodsReceipt", GoodsReceiptSchema);

/* ---------- Danh mục nguyên liệu + lịch sử giá nhập ---------- */
const GoodsItemSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    unit: { type: String, default: "" }, // đơn vị tính giá (hộp, kg…)
    aliases: { type: [String], default: [] }, // cách gọi tắt: mn, bột na…
    // giá nhập theo ngày áp dụng: từ 15/11 = 20.000 (trước đó 19.000)
    prices: { type: [{ _id: false, from: String, price: Number, by: String, at: Date }], default: [] },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true }, // xoá = ẩn (giữ lịch sử)
  },
  { timestamps: true },
);
export type GoodsItemDoc = InferSchemaType<typeof GoodsItemSchema> & { _id: Types.ObjectId };
export const GoodsItemModel = getModel("GoodsItem", GoodsItemSchema);

/* ---------- Tài chính: chi phí (bill), chi phí cố định, nhật ký báo cáo ---------- */
const ShareSchema = new Schema({ storeId: { type: Schema.Types.ObjectId, ref: "Store" }, pct: Number }, { _id: false });
const ExpenseSchema = new Schema(
  {
    date: { type: String, required: true }, // ngày chi YYYY-MM-DD
    month: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, required: true },
    vendor: String, // nơi bán
    items: String, // chi cho cái gì / các món
    transferNote: String, // nội dung chuyển khoản (nếu là ảnh CK)
    kind: { type: String, enum: ["BILL", "TRANSFER"], default: "BILL" },
    note: String,
    // STORE = của 1 cơ sở · SHARED = chung, chia cho các cơ sở theo allocation
    scope: { type: String, enum: ["STORE", "SHARED"], default: "STORE" },
    storeId: { type: Schema.Types.ObjectId, ref: "Store" },
    allocation: { type: String, enum: ["REVENUE", "EQUAL", "CUSTOM"], default: "REVENUE" },
    customShares: [ShareSchema],
    // OWNER = Admin Tổng trả / chuyển khoản · CASHBOX = lấy tiền két (đã nằm trong "Thu chi" chốt ca → không cộng lại)
    paidFrom: { type: String, enum: ["OWNER", "CASHBOX"], default: "OWNER" },
    // có tính vào chi phí lãi lỗ không (trống = theo mục: lương/thưởng không tính, còn lại tính)
    countInCost: Boolean,
    ocr: { status: { type: String, enum: ["NONE", "OK", "FAILED"], default: "NONE" }, amount: Number, date: String },
    telegram: { status: { type: String, enum: ["PENDING", "SENT", "FAILED", "DISABLED"], default: "PENDING" }, messageIds: [Number], error: String },
    createdBy: String,
    updatedBy: String,
  },
  { timestamps: true },
);
ExpenseSchema.index({ month: 1, date: 1 });
ExpenseSchema.index({ date: 1, amount: 1 });
export type ExpenseDoc = InferSchemaType<typeof ExpenseSchema> & { _id: Types.ObjectId };
export const Expense = getModel("Expense", ExpenseSchema);

const FixedCostSchema = new Schema(
  {
    name: { type: String, required: true }, // VD "Mặt bằng Văn Phú"
    category: { type: String, required: true },
    amountPerMonth: { type: Number, required: true },
    scope: { type: String, enum: ["STORE", "SHARED"], default: "STORE" },
    storeId: { type: Schema.Types.ObjectId, ref: "Store" },
    allocation: { type: String, enum: ["REVENUE", "EQUAL", "CUSTOM"], default: "REVENUE" },
    customShares: [ShareSchema],
    startMonth: { type: String, required: true }, // YYYY-MM
    endMonth: String, // trống = đang áp dụng
    note: String,
    createdBy: String,
  },
  { timestamps: true },
);
export type FixedCostDoc = InferSchemaType<typeof FixedCostSchema> & { _id: Types.ObjectId };
export const FixedCost = getModel("FixedCost", FixedCostSchema);

/** Mỗi báo cáo chỉ gửi 1 lần (key VD "daily:2026-11-08", "weekly:2026-11-02", "monthly:2026-10"). */
const ReportLogSchema = new Schema({
  key: { type: String, required: true, unique: true },
  status: { type: String, enum: ["SENT", "FAILED"], default: "SENT" },
  error: String,
  sentAt: { type: Date, default: Date.now, expires: 180 * 86_400 }, // TTL: tự xoá sau 180 ngày
});
export const ReportLog = getModel("ReportLog", ReportLogSchema);

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
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User" }, // nhân viên được cấp quyền tạo → chỉ người đó sửa / xoá được
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
    holidayHours: { type: Number, default: 0 }, // trong tổng giờ: số giờ làm ngày lễ
    holidayExtra: { type: Number, default: 0 }, // tiền cộng thêm do làm ngày lễ (đã gồm trong lương cơ bản)
    holidayNote: String, // VD "Quốc khánh 02/09 8h ×2"
    // đã trả lương cho nhân viên này → dòng lương + chấm công / thưởng phạt tháng này của họ bị KHOÁ (mở khoá cần lý do)
    paidAt: Date,
    paidBy: String,
    // công bố RIÊNG cho nhân viên này (bảng còn nháp) – nhân viên xem được dòng lương của mình
    publishedAt: Date,
    publishedBy: String,
    // ghi chú từng lần cộng phụ cấp / tạm ứng (VD qua Trợ lý AI: "Hỗ trợ ship 31 đơn × 5k")
    extrasNotes: {
      type: [{ _id: false, field: { type: String, enum: ["allowance", "advance"] }, amount: Number, note: String, by: String, at: Date }],
      default: [],
    },
    // ảnh chụp lúc tính: bảng đã công bố / đã trả giữ nguyên tên, tài khoản, chi tiết thưởng phạt dù dữ liệu gốc đổi sau đó
    userName: String,
    bankName: String,
    bankAccountEnc: String, // STK mã hoá AES (như User)
    bpDetails: {
      type: [{ _id: false, kind: { type: String, enum: ["BONUS", "PENALTY"] }, date: String, content: String, amountVnd: Number }],
      default: undefined,
    },
  },
  { timestamps: true },
);
PayrollItemSchema.index({ payrollId: 1, userId: 1 }, { unique: true });
export const PayrollItem = getModel("PayrollItem", PayrollItemSchema);
/** Chi tiết thưởng / phạt đã chốt trong 1 dòng lương (undefined = dòng cũ chưa có bản chốt) */
export type BpDetail = { kind?: "BONUS" | "PENALTY" | null; date?: string | null; content?: string | null; amountVnd?: number | null };
/** Ghi chú cộng phụ cấp / tạm ứng của 1 dòng lương */
export type ExtrasNote = { field?: "allowance" | "advance" | null; amount?: number | null; note?: string | null; by?: string | null; at?: Date | null };

/** Ngày nghỉ lễ: nhân viên đi làm ngày này được nhân lương giờ (mặc định ×2, tuỳ chọn ×3, ×4). Áp dụng mọi cơ sở. */
const HolidaySchema = new Schema(
  {
    date: { type: String, required: true, unique: true }, // YYYY-MM-DD
    name: { type: String, required: true },
    multiplier: { type: Number, default: 2, min: 1, max: 10 },
    createdBy: String,
  },
  { timestamps: true },
);
export const Holiday = getModel("Holiday", HolidaySchema);

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
  kind: { type: String, enum: ["OWNER", "PASSWORD", "GOOGLE"] },
  displayName: String, // GOOGLE: email admin
  success: Boolean,
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now, expires: 180 * 86_400 }, // TTL: tự xoá sau 180 ngày
});
export const AdminLoginLog = getModel("AdminLoginLog", AdminLoginLogSchema);

/* ---------- Tài khoản admin: đăng nhập bằng Gmail được Admin Tổng thêm / duyệt, phân quyền ---------- */
const AdminDeviceSchema = new Schema(
  {
    deviceId: { type: String, required: true }, // cookie thiết bị admin (tbs_admin_dev) – chỉ để Admin Tổng xem
    userAgent: String,
    ip: String,
    status: { type: String, enum: ["PENDING", "APPROVED"], default: "PENDING" },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    approvedAt: Date,
  },
  { _id: false },
);
const AdminAccountSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true }, // Gmail đăng nhập
    name: { type: String, required: true }, // tên hiển thị trong lịch sử thao tác
    status: { type: String, enum: ["PENDING", "ACTIVE", "BLOCKED"], default: "PENDING" },
    perms: { type: [String], default: [] }, // lib/permissions.ts ADMIN_PERMS
    devices: { type: [AdminDeviceSchema], default: [] },
    note: String,
    approvedBy: String,
    approvedAt: Date,
    lastLoginAt: Date,
    lastIp: String,
    lastUserAgent: String,
  },
  { timestamps: true },
);
export type AdminAccountDoc = InferSchemaType<typeof AdminAccountSchema> & { _id: Types.ObjectId };
export const AdminAccount = getModel("AdminAccount", AdminAccountSchema);

/* ---------- Sổ quỹ: rút lãi / bổ sung vốn / chuyển giữa tiền mặt và tài khoản (xem lib/cashbook) ---------- */
const CashTransferSchema = new Schema(
  {
    storeId: { type: Schema.Types.ObjectId, ref: "Store" }, // trống = chung cả chuỗi
    date: { type: String, required: true }, // YYYY-MM-DD
    month: { type: String, required: true, index: true },
    // DEPOSIT = nộp tiền mặt vào tài khoản (TM ↓, TK ↑) · WITHDRAW = rút tài khoản ra tiền mặt (TK ↓, TM ↑)
    // TAKE = rút ra (rút lãi) · ADD = bổ sung vốn – theo account TK / TM
    kind: { type: String, enum: ["DEPOSIT", "WITHDRAW", "TAKE", "ADD"], required: true },
    account: { type: String, enum: ["TK", "TM"] },
    amount: { type: Number, required: true, min: 1 },
    note: String,
    createdBy: String,
  },
  { timestamps: true },
);
export const CashTransfer = getModel("CashTransfer", CashTransferSchema);

/* ---------- Nhật ký thao tác của nhân viên được cấp quyền quản lý (hiện ở Tổng quan từng cơ sở) ---------- */
const StaffActivitySchema = new Schema({
  storeId: { type: Schema.Types.ObjectId, ref: "Store", index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  userName: String,
  action: String,
  summary: String,
  createdAt: { type: Date, default: Date.now, expires: 30 * 86_400 }, // TTL 30 ngày
});
StaffActivitySchema.index({ storeId: 1, createdAt: -1 });
export const StaffActivity = getModel("StaffActivity", StaffActivitySchema);

/* ---------- AI: mỗi lần gọi Gemini 1 dòng – thống kê token, giới hạn theo chức năng ---------- */
const AiUsageSchema = new Schema({
  feature: { type: String, required: true },
  actor: String, // "user:<id>" | "admin:<id|owner>" | "system"
  tokens: { type: Number, default: 0 },
  model: String,
  ok: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now, expires: 400 * 86_400 },
});
AiUsageSchema.index({ feature: 1, createdAt: -1 });
AiUsageSchema.index({ createdAt: -1 });
export const AiUsage = getModel("AiUsage", AiUsageSchema);

/** Từng lần gọi API Gemini (để đếm lượt gói miễn phí theo key × model × ngày giờ Mỹ – xem lib/ai-free) */
const AiCallSchema = new Schema({
  day: { type: String, required: true }, // YYYY-MM-DD theo giờ Pacific (Google reset lượt ngày lúc 0h Pacific)
  keyTag: String, // mã băm của API key (không lưu key)
  model: String,
  status: Number, // 200 OK · 429 hết lượt · 0 quá giờ · khác = lỗi
  perDay: Boolean, // 429 do hết lượt NGÀY
  tokens: { type: Number, default: 0 },
  inTokens: { type: Number, default: 0 },
  outTokens: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now, expires: 10 * 86_400 },
});
AiCallSchema.index({ day: 1, keyTag: 1, model: 1 });
export const AiCall = getModel("AiCall", AiCallSchema);

/** Trợ lý cửa hàng: câu hỏi của nhân viên (để admin biết câu nào chưa trả lời được). */
const AssistantLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  storeId: { type: Schema.Types.ObjectId, ref: "Store" },
  question: String,
  status: { type: String, enum: ["ANSWERED", "MISSING", "OUT_OF_SCOPE", "ERROR"] },
  createdAt: { type: Date, default: Date.now, expires: 90 * 86_400 },
});
export const AssistantLog = getModel("AssistantLog", AssistantLogSchema);

/** Bất thường chốt ca & két: kết quả mỗi lần rà + đánh dấu đã xử lý. */
const AnomalyRunSchema = new Schema({
  from: String,
  to: String,
  items: { type: [Schema.Types.Mixed], default: [] },
  byStaff: { type: [Schema.Types.Mixed], default: [] },
  summary: String,
  createdAt: { type: Date, default: Date.now, expires: 120 * 86_400 },
});
export const AnomalyRun = getModel("AnomalyRun", AnomalyRunSchema);
const AnomalyResolvedSchema = new Schema({
  key: { type: String, required: true, unique: true },
  by: String,
  createdAt: { type: Date, default: Date.now, expires: 120 * 86_400 },
});
export const AnomalyResolved = getModel("AnomalyResolved", AnomalyResolvedSchema);

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

/* ---------- Phiên đăng nhập admin (mật khẩu chung) – Admin Tổng xem & đăng xuất từng phiên ---------- */
const AdminLoginSessionSchema = new Schema({
  sid: { type: String, required: true, unique: true },
  name: String, // tên hiển thị admin tự nhập khi đăng nhập
  ip: String,
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  lastSeenAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }, // hết hạn phiên → tự xoá (TTL bên dưới)
  revokedAt: Date,
  revokedBy: String,
  accountId: { type: Schema.Types.ObjectId, ref: "AdminAccount", index: true },
  deviceId: String,
});
AdminLoginSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AdminLoginSession = getModel("AdminLoginSession", AdminLoginSessionSchema);

/* ---------- Lịch sử hoạt động admin (không gồm Admin Tổng) – chỉ giữ 7 ngày ---------- */
export const ACTIVITY_DAYS = 7;
const AdminActivitySchema = new Schema({
  sid: String,
  adminName: String,
  action: { type: String, index: true },
  targetType: String,
  targetId: String,
  summary: String,
  storeId: { type: Schema.Types.ObjectId, ref: "Store" },
  createdAt: { type: Date, default: Date.now, expires: ACTIVITY_DAYS * 86_400 }, // TTL 7 ngày
});
export const AdminActivity = getModel("AdminActivity", AdminActivitySchema);
