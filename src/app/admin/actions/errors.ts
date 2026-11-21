"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { ErrorLog, Settings } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { clampLogDays, forgetErrorLogDays, track } from "@/lib/error-log";
import { errMsg, type FormState } from "./types";

const PAGE = "/admin/settings/errors";

/** Đổi số ngày giữ log (Admin Tổng). Log đang có cũng tính lại hạn xoá = lúc xảy ra + số ngày mới. */
async function saveErrorLogDays__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertOwner();
    await connectDB();
    const days = clampLogDays(fd.get("days"));
    await Settings.updateOne({ key: "main" }, { $set: { errorLogDays: days } }, { upsert: true });
    await ErrorLog.updateMany({}, [{ $set: { expireAt: { $add: [{ $ifNull: ["$lastAt", "$createdAt"] }, days * 86_400_000] } } }]);
    forgetErrorLogDays();
    await audit(adminActor(admin), "settings.errorLogDays", { type: "Settings" }, null, { errorLogDays: days });
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Xoá log: 1 dòng (id) hoặc tất cả. */
async function clearErrorLogs__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertOwner();
    await connectDB();
    const id = String(fd.get("id") ?? "");
    if (id) await ErrorLog.deleteOne({ _id: id });
    else {
      const r = await ErrorLog.deleteMany({});
      await audit(adminActor(admin), "errorLog.clear", { type: "ErrorLog" }, null, { deleted: r.deletedCount });
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function saveErrorLogDays(...a: Parameters<typeof saveErrorLogDays__>) { return track("Admin › Log lỗi hệ thống", "saveErrorLogDays", () => saveErrorLogDays__(...a)); }
export async function clearErrorLogs(...a: Parameters<typeof clearErrorLogs__>) { return track("Admin › Log lỗi hệ thống", "clearErrorLogs", () => clearErrorLogs__(...a)); }
