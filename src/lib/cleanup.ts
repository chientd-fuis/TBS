import mongoose, { type Model } from "mongoose";
import { connectDB } from "./db";
import {
  AdjustmentRequest,
  AdminLoginLog,
  Attendance,
  AttendanceAdjustment,
  AuditLog,
  CoverRequest,
  DayRevenue,
  Device,
  Expense,
  FaceProfile,
  LoginLog,
  PayrollFeedback,
  PayrollItem,
  PendingPhoto,
  ReportLog,
  Settings,
  ShiftAssignment,
  ShiftClosing,
  ShiftRegRequest,
  Store,
  User,
  UserNotice,
} from "./models";
import { addDays, DEFAULT_TZ, localDate, localMonth, nextMonth, prevMonth, zonedToDate } from "./time";
import { trashOldPhotoFolders } from "./drive";
import { AUTO_KEYS_UI as AUTO_KEYS, CLEANUP_ITEMS, CLEANUP_KEYS, fmtBytes, type CleanupCounts, type CleanupKey, type CleanupPart } from "./cleanup-items";

/* Dọn dữ liệu cũ (chỉ Chủ). KHÔNG xoá bản ghi chấm công, ca làm chính thức, thưởng/phạt, lương, chi phí. */

export type { CleanupCounts, CleanupKey } from "./cleanup-items";
export type CleanupOpts = { beforeMonth: string; drivePhotos?: boolean } & Partial<Record<CleanupKey, boolean>>;

export const STUCK_ATTEMPTS = 20;
const DAY = 86_400_000;

/** Mốc an toàn (mặc định + tự dọn hằng tháng): giữ lại tháng hiện tại + 2 tháng trước. */
export function safeCutoff(now = new Date()) {
  return prevMonth(prevMonth(localMonth(now, DEFAULT_TZ)));
}
/** Mốc xa nhất Chủ được chọn tay: tháng sau = xoá cả tháng hiện tại (và tháng trước). */
export function latestCutoff(now = new Date()) {
  return nextMonth(localMonth(now, DEFAULT_TZ));
}

function validate(o: CleanupOpts) {
  if (!/^\d{4}-\d{2}$/.test(o.beforeMonth)) throw new Error("Tháng không hợp lệ");
  if (o.beforeMonth > latestCutoff()) throw new Error("Tháng không hợp lệ");
  if (!CLEANUP_KEYS.some((k) => o[k])) throw new Error("Chọn ít nhất 1 loại dữ liệu");
}

/** pastDate: mốc cho đơn / ca theo ngày – không bao giờ quá hôm nay (chọn xoá cả tháng này vẫn giữ đơn, ca của các ngày sắp tới). */
type Ctx = { month: string; cutoff: Date; cutoffDate: string; pastDate: string; regDate: string; today: string; now: Date };
const ctxOf = (o: CleanupOpts): Ctx => {
  const now = new Date();
  const cutoffDate = `${o.beforeMonth}-01`;
  const today = localDate(now, DEFAULT_TZ);
  const pastDate = cutoffDate < today ? cutoffDate : today;
  return {
    month: o.beforeMonth,
    cutoff: zonedToDate(cutoffDate, "00:00", DEFAULT_TZ),
    cutoffDate,
    pastDate,
    regDate: cutoffDate < today ? cutoffDate : addDays(today, -7), // đăng ký ca: giữ tuần hiện tại
    today,
    now,
  };
};

type Q = Record<string, unknown>;
/** 1 thao tác: đếm (preview) hoặc thực hiện (run) – trả về số bản ghi bị ảnh hưởng. */
type Op = { label: string; count: () => Promise<number>; run: () => Promise<number> };
const del = (label: string, m: Model<any>, q: Q): Op => ({ label, count: () => m.countDocuments(q), run: async () => (await m.deleteMany(q)).deletedCount ?? 0 }); // eslint-disable-line @typescript-eslint/no-explicit-any
const upd = (label: string, m: Model<any>, q: Q, u: Q): Op => ({ label, count: () => m.countDocuments(q), run: async () => (await m.updateMany(q, u)).modifiedCount }); // eslint-disable-line @typescript-eslint/no-explicit-any

const ids = (rows: { _id: unknown }[]) => rows.map((r) => r._id);
const userIds = async () => ids(await User.find().select("_id").lean());
const storeIds = async () => ids(await Store.find().select("_id").lean());
/** Người đã nghỉ / bị từ chối, cập nhật lần cuối trước mốc. */
const leftUserIds = async (c: Ctx) => ids(await User.find({ status: { $in: ["INACTIVE", "REJECTED"] }, updatedAt: { $lt: c.cutoff } }).select("_id").lean());

/** Tài khoản rác: mới đăng ký bỏ dở / bị từ chối, tạo trước mốc, chưa từng chấm công, chưa có lương. */
async function junkUserIds(c: Ctx) {
  const cand = ids(await User.find({ status: { $in: ["NEW", "REJECTED"] }, createdAt: { $lt: c.cutoff } }).select("_id").lean());
  if (!cand.length) return [];
  const [att, pay] = await Promise.all([Attendance.distinct("userId", { userId: { $in: cand } }), PayrollItem.distinct("userId", { userId: { $in: cand } })]);
  const used = new Set([...att, ...pay].map(String));
  return cand.filter((i) => !used.has(String(i)));
}

/** Doanh thu ngày không còn bản chốt ca nào. */
async function orphanDayIds() {
  const rows = await DayRevenue.aggregate<{ _id: unknown }>([
    {
      $lookup: {
        from: ShiftClosing.collection.name,
        let: { s: "$storeId", d: "$date" },
        pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$storeId", "$$s"] }, { $eq: ["$workDate", "$$d"] }] } } }, { $limit: 1 }, { $project: { _id: 1 } }],
        as: "c",
      },
    },
    { $match: { c: { $size: 0 } } },
    { $project: { _id: 1 } },
  ]);
  return ids(rows);
}

/** Danh sách thao tác cho từng loại. Các truy vấn cần tra cứu trước (id người dùng…) chạy ở đây. */
async function opsFor(key: CleanupKey, c: Ctx): Promise<Op[]> {
  const byDate = { createdAt: { $lt: c.cutoff } };
  switch (key) {
    case "loginLogs":
      return [del("đăng nhập nhân viên", LoginLog, byDate), del("đăng nhập admin", AdminLoginLog, byDate)];
    case "auditLogs":
      return [del("dòng nhật ký", AuditLog, byDate)];
    case "adjustLogs":
      return [del("dòng lịch sử sửa công", AttendanceAdjustment, byDate)];
    case "reportLogs":
      return [del("dòng nhật ký báo cáo", ReportLog, { sentAt: { $lt: c.cutoff } })];
    case "notices":
      return [del("thông báo", UserNotice, { $or: [byDate, { readAt: { $lt: new Date(c.now.getTime() - 30 * DAY) } }] })];
    case "requests":
      return [
        del("đơn nhờ làm hộ cũ", CoverRequest, { date: { $lt: c.pastDate } }),
        upd("đơn nhờ làm hộ hết hạn", CoverRequest, { status: "PENDING", date: { $lt: c.today, $gte: c.pastDate } }, { $set: { status: "CANCELLED", reply: "Hết hạn (ca đã qua)", decidedBy: "Hệ thống", decidedAt: c.now } }),
        upd("đơn đổi ca hết hạn", CoverRequest, { status: "PENDING", kind: "SWAP", toDate: { $lt: c.today } }, { $set: { status: "CANCELLED", reply: "Hết hạn (1 trong 2 ca đã qua)", decidedBy: "Hệ thống", decidedAt: c.now } }),
        del("đơn sửa công đã xử lý", AdjustmentRequest, { status: { $ne: "PENDING" }, ...byDate }),
        del("lượt đăng ký ca tuần cũ", ShiftRegRequest, { weekStart: { $lt: c.regDate } }),
        del("ca bị từ chối", ShiftAssignment, { status: "REJECTED", date: { $lt: c.pastDate } }),
        upd("ca đăng ký chờ duyệt đã qua → từ chối", ShiftAssignment, { status: "PENDING", date: { $lt: c.today } }, { $set: { status: "REJECTED", decidedBy: "Hệ thống (hết hạn)", decidedAt: c.now } }),
      ];
    case "payrollFeedback":
      return [del("phản hồi lương", PayrollFeedback, { status: "RESOLVED", month: { $lt: c.month } })];
    case "stuckPhotos":
      return [del("ảnh tạm bị kẹt", PendingPhoto, { attempts: { $gte: STUCK_ATTEMPTS } })];
    case "devices": {
      const left = await leftUserIds(c);
      return [
        del("thiết bị bị từ chối / thu hồi", Device, { status: { $in: ["REJECTED", "REVOKED"] }, updatedAt: { $lt: c.cutoff } }),
        del("thiết bị của người đã nghỉ", Device, { userId: { $in: left }, status: { $nin: ["REJECTED", "REVOKED"] }, lastSeenAt: { $lt: c.cutoff } }),
      ];
    }
    case "faces": {
      const left = await leftUserIds(c);
      return [
        del("hồ sơ khuôn mặt", FaceProfile, { userId: { $in: left } }),
        del("ảnh khuôn mặt chờ tải", PendingPhoto, { target: { $in: left.map((i) => `face:${i}`) } }),
      ];
    }
    case "junkUsers": {
      const u = await junkUserIds(c);
      const mine = { userId: { $in: u } };
      // xoá dữ liệu kèm theo TRƯỚC, tài khoản xoá sau cùng
      return [
        del("khuôn mặt", FaceProfile, mine),
        del("thiết bị", Device, mine),
        del("lượt đăng nhập", LoginLog, mine),
        del("thông báo", UserNotice, mine),
        del("ca xếp", ShiftAssignment, mine),
        del("lượt đăng ký ca", ShiftRegRequest, mine),
        del("ảnh tạm", PendingPhoto, { $or: [mine, { target: { $in: u.map((i) => `face:${i}`) } }] }),
        del("đơn nhờ làm hộ", CoverRequest, { $or: [{ fromUserId: { $in: u } }, { toUserId: { $in: u } }] }),
        del("tài khoản", User, { _id: { $in: u } }),
      ];
    }
    case "orphans": {
      const [u, s, days] = await Promise.all([userIds(), storeIds(), orphanDayIds()]);
      const noUser = { userId: { $nin: u } };
      return [
        del("ngày doanh thu không còn chốt ca", DayRevenue, { _id: { $in: days } }),
        del("ca xếp của người / cơ sở đã xoá", ShiftAssignment, { $or: [noUser, { storeId: { $nin: s } }] }),
        del("thông báo của người đã xoá", UserNotice, noUser),
        del("thiết bị của người đã xoá", Device, noUser),
        del("đăng nhập của người đã xoá", LoginLog, noUser),
        del("hồ sơ khuôn mặt của người đã xoá", FaceProfile, noUser),
        del("đăng ký ca của người / cơ sở đã xoá", ShiftRegRequest, { $or: [noUser, { storeId: { $nin: s } }] }),
      ];
    }
    case "metaData":
      return [
        upd("lượt chốt ca", ShiftClosing, { workDate: { $lt: c.cutoffDate }, $or: [{ "ocr.status": { $exists: true } }, { webhook: { $exists: true } }, { "telegram.messageIds.0": { $exists: true } }] }, {
          $unset: { ocr: 1, webhook: 1, "telegram.messageIds": 1, "telegram.error": 1 },
        }),
        upd("khoản chi phí", Expense, { ...byDate, $or: [{ ocr: { $exists: true } }, { "telegram.messageIds.0": { $exists: true } }] }, { $unset: { ocr: 1, "telegram.messageIds": 1, "telegram.error": 1 } }),
      ];
    case "photos":
      return [
        upd(
          "lượt chấm công (ảnh)",
          Attendance,
          {
            month: { $lt: c.month },
            $or: [{ checkInPhotoId: { $nin: [null, ""] } }, { checkOutPhotoId: { $nin: [null, ""] } }, { checkInPendingPhotoId: { $ne: null } }, { checkOutPendingPhotoId: { $ne: null } }],
          },
          { $unset: { checkInPhotoId: 1, checkOutPhotoId: 1, checkInPendingPhotoId: 1, checkOutPendingPhotoId: 1 }, $set: { photosPurgedAt: c.now } },
        ),
        upd("lượt chốt ca (ảnh)", ShiftClosing, { workDate: { $lt: c.cutoffDate }, "photos.0": { $exists: true } }, { $set: { photos: [], photosPurgedAt: c.now } }),
        del("ảnh tạm trong database", PendingPhoto, byDate),
      ];
    case "closings":
      return [del("lượt chốt ca", ShiftClosing, { workDate: { $lt: c.cutoffDate } }), del("ngày doanh thu", DayRevenue, { date: { $lt: c.cutoffDate } })];
  }
}

async function warnFor(key: CleanupKey, c: Ctx) {
  if (key !== "closings") return undefined;
  const n = await DayRevenue.countDocuments({ date: { $lt: c.cutoffDate }, "sheet.status": { $ne: "SENT" } });
  return n ? `${n} ngày doanh thu CHƯA ghi được lên Google Sheet – xoá là mất số liệu các ngày này. Nên vào Tài chính → Doanh thu theo ngày bấm “Ghi sheet” trước.` : undefined;
}

const chosen = (o: CleanupOpts) => CLEANUP_KEYS.filter((k) => o[k]);

/** Đếm trước. all=true → đếm mọi loại (để hiện số cạnh từng ô). */
export async function previewCleanup(o: CleanupOpts, all = false): Promise<CleanupCounts> {
  if (!all) validate(o);
  await connectDB();
  const c = ctxOf(o);
  const out: CleanupCounts = {};
  await Promise.all(
    (all ? [...CLEANUP_KEYS] : chosen(o)).map(async (k) => {
      const ops = await opsFor(k, c);
      const parts = await Promise.all(ops.map(async (op) => [op.label, await op.count()] as [string, number]));
      out[k] = { total: parts.reduce((s, [, n]) => s + n, 0), parts, warn: await warnFor(k, c) };
    }),
  );
  return out;
}

export async function runCleanup(o: CleanupOpts, budgetMs = 45_000): Promise<CleanupCounts> {
  validate(o);
  await connectDB();
  const deadline = Date.now() + budgetMs;
  const c = ctxOf(o);
  const out: CleanupCounts = {};
  if (o.photos && o.drivePhotos) {
    const r = await trashOldPhotoFolders(o.beforeMonth, deadline - 5_000);
    out.driveFolders = r.trashed;
    out.driveRemaining = r.remaining;
  }
  // tuần tự: tránh 2 loại cùng đụng 1 bảng (VD tài khoản rác + dữ liệu mồ côi)
  for (const k of chosen(o)) {
    const part: CleanupPart = { total: 0, parts: [] };
    for (const op of await opsFor(k, c)) {
      const n = await op.run();
      part.parts.push([op.label, n]);
      part.total += n;
    }
    out[k] = part;
  }
  return out;
}

/** Tóm tắt kết quả thành các dòng chữ (Telegram / nhật ký). */
export function summarize(r: CleanupCounts) {
  const lines: string[] = [];
  for (const it of CLEANUP_ITEMS) {
    const p = r[it.key];
    if (!p || !p.total) continue;
    lines.push(`• ${it.label}: ${p.parts.filter(([, n]) => n).map(([l, n]) => `${n} ${l}`).join(", ")}`);
  }
  if (r.driveFolders) lines.push(`• ${r.driveFolders} thư mục ảnh Drive → thùng rác`);
  return lines;
}

/* ---------- Dung lượng database ---------- */

export const FREE_TIER_BYTES = 512 * 1024 ** 2;
export type StorageStats = {
  dataSize: number;
  indexSize: number;
  storageSize: number;
  used: number; // dataSize + indexSize (Atlas tính theo số này)
  limit: number;
  collections: { name: string; count: number; size: number; indexSize: number }[];
};

export async function getStorageStats(): Promise<StorageStats> {
  await connectDB();
  const db = mongoose.connection.db!;
  const s = await db.stats();
  const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((x) => x.name).filter((n) => !n.startsWith("system."));
  const collections = await Promise.all(
    names.map(async (name) => {
      const col = db.collection(name);
      try {
        const [st] = await col.aggregate<{ storageStats: { count: number; size: number; totalIndexSize: number } }>([{ $collStats: { storageStats: {} } }]).toArray();
        return { name, count: st.storageStats.count, size: st.storageStats.size, indexSize: st.storageStats.totalIndexSize };
      } catch {
        return { name, count: await col.estimatedDocumentCount(), size: 0, indexSize: 0 };
      }
    }),
  );
  collections.sort((a, b) => b.size + b.indexSize - (a.size + a.indexSize) || b.count - a.count);
  return { dataSize: s.dataSize, indexSize: s.indexSize, storageSize: s.storageSize, used: s.dataSize + s.indexSize, limit: FREE_TIER_BYTES, collections };
}

/* ---------- Tự xoá theo thời gian (TTL index) ---------- */

const TTL: { model: Model<any>; field: string; days: number }[] = [ // eslint-disable-line @typescript-eslint/no-explicit-any
  { model: LoginLog, field: "createdAt", days: 180 },
  { model: AdminLoginLog, field: "createdAt", days: 180 },
  { model: UserNotice, field: "readAt", days: 30 },
  { model: ReportLog, field: "sentAt", days: 180 },
];

/** Đổi index thường → TTL cho các bảng log (dữ liệu cũ đã có index createdAt thường). Chạy nhiều lần không sao. */
export async function ensureTtlIndexes() {
  await connectDB();
  const changed: string[] = [];
  for (const t of TTL) {
    const sec = t.days * 86_400;
    const col = t.model.collection;
    try {
      const idx = (await col.indexes()).find((i) => Object.keys(i.key).length === 1 && i.key[t.field] === 1);
      if (idx?.expireAfterSeconds === sec) continue;
      if (idx?.name) await col.dropIndex(idx.name);
      await col.createIndex({ [t.field]: 1 }, { expireAfterSeconds: sec });
      changed.push(`${col.collectionName}.${t.field}`);
    } catch (e) {
      console.error("ensureTtlIndexes", col.collectionName, e);
    }
  }
  return changed;
}

/* ---------- Tự dọn hằng tháng (cron) ---------- */


/** Mỗi tháng 1 lần (cron hằng ngày gọi): dọn các loại an toàn, báo nhóm Telegram Quản lý doanh thu. */
export async function runAutoCleanup(now = new Date()) {
  await connectDB();
  const s = await Settings.findOne({ key: "main" }).select("autoCleanup").lean();
  if (!s?.autoCleanup) return { skipped: "off" };
  const key = `cleanup:${localMonth(now, DEFAULT_TZ)}`;
  if (await ReportLog.findOne({ key, status: "SENT" }).lean()) return { skipped: "done" };
  const opts: CleanupOpts = { beforeMonth: safeCutoff(now), ...Object.fromEntries(AUTO_KEYS.map((k) => [k, true])) };
  try {
    const r = await runCleanup(opts, 30_000);
    await ReportLog.updateOne({ key }, { $set: { status: "SENT", sentAt: new Date() }, $unset: { error: 1 } }, { upsert: true });
    const { audit } = await import("./audit");
    await audit({ kind: "SYSTEM", name: "Tự dọn hằng tháng" }, "data.cleanup.auto", { type: "Settings" }, null, { opts, counts: r });
    const lines = summarize(r);
    const { financeChatId } = await import("./finance-report");
    const { sendTelegramText, telegramConfigured } = await import("./telegram");
    const chat = await financeChatId();
    if (telegramConfigured() && chat) {
      const st = await getStorageStats().catch(() => null);
      const text = [
        `🧹 Tự dọn dữ liệu tháng ${key.slice(-2)}/${key.slice(8, 12)} (dữ liệu trước ${opts.beforeMonth.slice(5)}/${opts.beforeMonth.slice(0, 4)})`,
        ...(lines.length ? lines : ["Không có gì cần dọn."]),
        st ? `💾 Database: ${fmtBytes(st.used)} / ${fmtBytes(st.limit)} (${Math.round((st.used / st.limit) * 100)}%)` : "",
      ].filter(Boolean);
      await sendTelegramText(chat, text.join("\n").slice(0, 4000)).catch(() => 0);
    }
    return { cleaned: lines.length };
  } catch (e) {
    await ReportLog.updateOne({ key }, { $set: { status: "FAILED", error: (e as Error).message, sentAt: new Date() } }, { upsert: true });
    return { error: (e as Error).message };
  }
}

/** Lần tự dọn gần nhất (hiển thị ở cài đặt). */
export async function lastAutoCleanup() {
  await connectDB();
  const r = await ReportLog.findOne({ key: /^cleanup:/ }).sort({ sentAt: -1 }).lean();
  return r ? { month: r.key.slice(8), status: r.status, at: r.sentAt?.toISOString() ?? null, error: r.error ?? null } : null;
}
