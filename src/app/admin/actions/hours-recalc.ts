"use server";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { Settings, User } from "@/lib/models";
import { assertAdmin, assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { track } from "@/lib/error-log";
import { applyUserMonth, cancelUserMonth, recalcConfig } from "@/lib/hours-recalc-server";
import { RECALC_MAX_SHORT, RECALC_MODES, RECALC_THRESHOLDS, type RecalcMode } from "@/lib/hours-recalc";
import { dec, errMsg, num, str, type FormState } from "./types";

/*
 * Bảng chấm công → Tính lại giờ công (từng người / hàng loạt) + Cài đặt tự động.
 * Công thức: lib/hours-recalc.ts · ghi DB: lib/hours-recalc-server.ts
 */

export type RecalcActionResult = { ok?: boolean; error?: string; done?: number; locked?: number; short?: string[] };

/** op "apply": tính lại (bỏ cờ Huỷ) · op "cancel": huỷ, giờ công về số chấm công gốc. Quyền: chấm hộ / sửa chấm công. */
async function recalcHours__(i: { storeId: string; month: string; userIds: string[]; op: "apply" | "cancel" }): Promise<RecalcActionResult> {
  try {
    const admin = await assertPerm("attendance.edit");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i?.month ?? "")) return { error: "Tháng không hợp lệ" };
    if (!isValidObjectId(i.storeId)) return { error: "Chọn cơ sở" };
    const ids = [...new Set((i.userIds ?? []).map(String))].filter((x) => isValidObjectId(x));
    if (!ids.length) return { error: "Chưa chọn nhân viên nào" };
    if (ids.length > 200) return { error: "Tối đa 200 nhân viên / lần" };
    await connectDB();
    // chỉ nhân viên thuộc cơ sở đang xem
    const users = await User.find({ _id: { $in: ids }, storeId: i.storeId }).select("name").lean();
    if (users.length !== ids.length) return { error: "Có nhân viên không thuộc cơ sở này – tải lại trang" };
    const actor = adminActor(admin);
    const conf = await recalcConfig();
    let done = 0;
    let locked = 0;
    const short: string[] = [];
    const log: { name: string; before?: number; after?: number }[] = [];
    for (const u of users) {
      const r = i.op === "cancel" ? await cancelUserMonth(u._id, i.month, actor.name) : await applyUserMonth(u._id, i.month, { by: actor.name, manual: true, conf });
      if (r.status === "locked") {
        locked++;
        continue;
      }
      done++;
      if (r.plan && !r.plan.enough) short.push(u.name);
      log.push({ name: u.name, before: r.plan?.before, after: r.plan?.after });
    }
    await audit(actor, i.op === "cancel" ? "attendance.hoursRecalc.cancel" : "attendance.hoursRecalc", { type: "Store", id: i.storeId }, null, { month: i.month, users: log });
    revalidatePath("/admin/attendance");
    revalidatePath("/admin/payroll");
    if (!done && locked) return { error: "Tháng này đã trả lương – không tính lại được" };
    return { ok: true, done, locked, short };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Cài đặt → Tự động tính lại giờ công (Admin Tổng). */
async function saveHoursRecalc__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đổi cài đặt này" };
    const mode = str(fd.get("mode")) as RecalcMode;
    if (!RECALC_MODES.some((m) => m.v === mode)) return { error: "Chọn khi nào tự tính" };
    const threshold = dec(fd.get("threshold"), 1);
    const maxShort = num(fd.get("maxShort"), 23);
    if (!(RECALC_THRESHOLDS as readonly number[]).includes(threshold)) return { error: "Ngưỡng chênh không hợp lệ" };
    if (!(RECALC_MAX_SHORT as readonly number[]).includes(maxShort)) return { error: "Số phút thiếu không hợp lệ" };
    await connectDB();
    const data = { hoursRecalcMode: mode, hoursRecalcThreshold: threshold, hoursRecalcMaxShort: maxShort };
    const before = await Settings.findOne({ key: "main" }).select("hoursRecalcMode hoursRecalcThreshold hoursRecalcMaxShort").lean();
    await Settings.updateOne({ key: "main" }, { $set: data });
    await audit(adminActor(admin), "settings.hoursRecalc", { type: "Settings" }, before, data);
    revalidatePath("/admin/settings");
    revalidatePath("/admin/attendance");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function recalcHours(...a: Parameters<typeof recalcHours__>) { return track("Admin › Tính lại giờ công", "recalcHours", () => recalcHours__(...a)); }
export async function saveHoursRecalc(...a: Parameters<typeof saveHoursRecalc__>) { return track("Admin › Tính lại giờ công", "saveHoursRecalc", () => saveHoursRecalc__(...a)); }
