import { Readable } from "node:stream";
import { auth, drive as driveApi, type drive_v3 } from "@googleapis/drive";
import { connectDB } from "./db";
import { decrypt, encrypt } from "./crypto";
import { PendingPhoto, Settings, Store } from "./models";
import { getSettings } from "./settings";

/* Google Drive (OAuth bằng Google account của Chủ) – chỉ dùng lưu ảnh chấm công. Spec 2.1, 6.1 */

export const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
const ROOT_FOLDER_NAME = "TBS Chấm công";

function redirectUri() {
  return `${process.env.NEXTAUTH_URL}/api/google/callback`;
}

export function oauthClient() {
  return new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
}

export function driveConsentUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DRIVE_SCOPES,
    state,
    login_hint: process.env.OWNER_EMAIL,
  });
}

export async function saveDriveTokenFromCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google không trả về refresh token – hãy thu hồi quyền app trong tài khoản Google rồi kết nối lại");
  client.setCredentials(tokens);
  let email = "";
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email ?? "";
  }
  await connectDB();
  await Settings.updateOne(
    { key: "main" },
    {
      $set: {
        googleRefreshTokenEnc: encrypt(tokens.refresh_token),
        googleAccountEmail: email,
        googleConnectedAt: new Date(),
        rootDriveFolderId: "",
      },
    },
  );
  await Store.updateMany({}, { $set: { driveFolderId: "" } });
  return email;
}

async function getDrive(): Promise<drive_v3.Drive | null> {
  const s = await getSettings();
  const refresh = decrypt(s.googleRefreshTokenEnc);
  if (!refresh) return null;
  const client = oauthClient();
  client.setCredentials({ refresh_token: refresh });
  return driveApi({ version: "v3", auth: client });
}

export async function isDriveConnected() {
  const s = await getSettings();
  return !!s.googleRefreshTokenEnc;
}

/** Kiểm tra kết nối thật sự (gọi API). */
export async function pingDrive(): Promise<{ ok: boolean; error?: string }> {
  try {
    const d = await getDrive();
    if (!d) return { ok: false, error: "Chưa kết nối" };
    await d.about.get({ fields: "user(emailAddress)" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function findOrCreateFolder(d: drive_v3.Drive, name: string, parentId?: string) {
  const safe = name.replace(/'/g, "\\'");
  const q = [
    `name = '${safe}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");
  const r = await d.files.list({ q, fields: "files(id)", pageSize: 1 });
  if (r.data.files?.[0]?.id) return r.data.files[0].id;
  const c = await d.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  return c.data.id!;
}

async function rootFolder(d: drive_v3.Drive) {
  const s = await getSettings();
  if (s.rootDriveFolderId) return s.rootDriveFolderId;
  const id = await findOrCreateFolder(d, ROOT_FOLDER_NAME);
  await Settings.updateOne({ key: "main" }, { $set: { rootDriveFolderId: id } });
  return id;
}

async function storeFolder(d: drive_v3.Drive, storeId: string) {
  const store = await Store.findById(storeId);
  if (!store) throw new Error("Không tìm thấy cơ sở");
  if (store.driveFolderId) return store.driveFolderId;
  const id = await findOrCreateFolder(d, store.name, await rootFolder(d));
  store.driveFolderId = id;
  await store.save();
  return id;
}

export type PhotoMeta = {
  storeId: string;
  userId: string;
  userFolderName: string; // tên nhân viên
  month: string; // YYYY-MM
  fileName: string; // VD 20261106_080045_in.jpg
  target: string; // attendance:<id>:in | attendance:<id>:out | face:<userId>
};

async function uploadToDrive(buf: Buffer, meta: PhotoMeta, mimeType = "image/jpeg") {
  const d = await getDrive();
  if (!d) throw new Error("Chưa kết nối Google Drive");
  const sf = await storeFolder(d, meta.storeId);
  const uf = await findOrCreateFolder(d, meta.userFolderName, sf);
  const mf = await findOrCreateFolder(d, meta.month, uf);
  const r = await d.files.create({
    requestBody: { name: meta.fileName, parents: [mf] },
    media: { mimeType, body: Readable.from(buf) },
    fields: "id",
  });
  return r.data.id!;
}

/**
 * Lưu ảnh: upload Drive; nếu lỗi → giữ tạm trong MongoDB (PendingPhoto), cron upload lại sau.
 * Trả về { driveId } hoặc { pendingId }.
 */
export async function savePhoto(buf: Buffer, meta: PhotoMeta): Promise<{ driveId?: string; pendingId?: string }> {
  try {
    return { driveId: await uploadToDrive(buf, meta) };
  } catch (e) {
    const p = await PendingPhoto.create({
      data: buf,
      fileName: meta.fileName,
      storeId: meta.storeId,
      userId: meta.userId,
      month: meta.month,
      target: meta.target,
      lastError: (e as Error).message,
      folderName: meta.userFolderName,
    });
    return { pendingId: String(p._id) };
  }
}

/** Upload lại các ảnh đang chờ. Trả về số ảnh upload thành công. */
export async function retryPendingPhotos(limit = 30) {
  const { Attendance, FaceProfile, User } = await import("./models");
  const items = await PendingPhoto.find({ attempts: { $lt: 20 } }).sort({ createdAt: 1 }).limit(limit);
  let ok = 0;
  for (const p of items) {
    try {
      const user = await User.findById(p.userId).lean();
      const driveId = await uploadToDrive(p.data, {
        storeId: String(p.storeId),
        userId: String(p.userId),
        userFolderName: user?.name || user?.email || "Unknown",
        month: p.month || "unknown",
        fileName: p.fileName || `${p._id}.jpg`,
        target: p.target || "",
      });
      const [kind, id, dir] = (p.target || "").split(":");
      if (kind === "attendance") {
        const field = dir === "out" ? "checkOutPhotoId" : "checkInPhotoId";
        const pend = dir === "out" ? "checkOutPendingPhotoId" : "checkInPendingPhotoId";
        await Attendance.updateOne({ _id: id }, { $set: { [field]: driveId }, $unset: { [pend]: 1 } });
      } else if (kind === "closing") {
        const { ShiftClosing } = await import("./models");
        await ShiftClosing.updateOne({ _id: id, "photos.pendingId": p._id }, { $set: { "photos.$.driveId": driveId }, $unset: { "photos.$.pendingId": 1 } });
      } else if (kind === "face") {
        await FaceProfile.updateOne({ userId: id }, { $set: { imageDriveId: driveId }, $unset: { pendingPhotoId: 1 } });
      }
      await p.deleteOne();
      ok++;
    } catch (e) {
      p.attempts = (p.attempts || 0) + 1;
      p.lastError = (e as Error).message;
      await p.save();
    }
  }
  return ok;
}

/** Đọc ảnh: từ Drive (fileId) hoặc từ PendingPhoto. */
export async function readPhoto(opts: { driveId?: string | null; pendingId?: string | null }) {
  if (opts.driveId) {
    const d = await getDrive();
    if (!d) return null;
    const r = await d.files.get({ fileId: opts.driveId, alt: "media" }, { responseType: "arraybuffer" });
    return Buffer.from(r.data as ArrayBuffer);
  }
  if (opts.pendingId) {
    const p = await PendingPhoto.findById(opts.pendingId).lean();
    if (!p) return null;
    const d = p.data as unknown;
    if (Buffer.isBuffer(d)) return d;
    // .lean() trả về BSON Binary → .buffer là Uint8Array đúng độ dài
    return Buffer.from((d as { buffer: Uint8Array }).buffer);
  }
  return null;
}

/**
 * Dọn ảnh cũ trên Drive: chuyển vào THÙNG RÁC (khôi phục được 30 ngày) các thư mục tháng
 * "YYYY-MM" (ảnh chấm công) và "Chốt ca YYYY-MM" có tháng < beforeMonth.
 * Chỉ thấy thư mục do app tạo (quyền drive.file). Dừng khi hết thời gian → trả về số còn lại.
 */
export async function trashOldPhotoFolders(beforeMonth: string, deadline: number) {
  const d = await getDrive();
  if (!d) return { trashed: 0, remaining: 0, connected: false };
  const old: string[] = [];
  let pageToken: string | undefined;
  do {
    const r = await d.files.list({
      q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      fields: "nextPageToken, files(id, name)",
      pageSize: 1000,
      pageToken,
    });
    for (const f of r.data.files ?? []) {
      const m = /^(?:Chốt ca )?(\d{4}-\d{2})$/.exec(f.name ?? "");
      if (m && m[1] < beforeMonth && f.id) old.push(f.id);
    }
    pageToken = r.data.nextPageToken ?? undefined;
  } while (pageToken && Date.now() < deadline);
  let trashed = 0;
  for (const id of old) {
    if (Date.now() > deadline) break;
    await d.files.update({ fileId: id, requestBody: { trashed: true } });
    trashed++;
  }
  return { trashed, remaining: old.length - trashed, connected: true };
}
