"use server";
import { revalidatePath } from "next/cache";
import { Settings } from "@/lib/models";
import { connectDB } from "@/lib/db";
import { assertAdmin, assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { dec, errMsg, num, type FormState } from "./types";
import { localDate } from "@/lib/time";

/** Cấu hình chấm công (làm tròn, ngưỡng muộn/sớm…) – Admin Tổng. */
export async function saveConfig(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đổi cấu hình" };
    const data = {
      roundStepHours: dec(fd.get("roundStepHours"), 0.5),
      roundGraceMinutes: Math.max(0, num(fd.get("roundGraceMinutes"), 0)),
      roundGraceHourMinutes: Math.max(0, num(fd.get("roundGraceHourMinutes"), num(fd.get("roundGraceMinutes"), 0))),
      lateThresholdMinutes: num(fd.get("lateThresholdMinutes"), 5),
      earlyThresholdMinutes: num(fd.get("earlyThresholdMinutes"), 5),
      minCheckoutMinutes: num(fd.get("minCheckoutMinutes"), 5),
      missingCheckoutHours: num(fd.get("missingCheckoutHours"), 16),
      maxDevicesPerUser: Math.max(1, num(fd.get("maxDevicesPerUser"), 1)),
      faceMatchThreshold: dec(fd.get("faceMatchThreshold"), 0.5),
      maxGpsAccuracyM: num(fd.get("maxGpsAccuracyM"), 100),
      adminSessionDays: Math.max(1, num(fd.get("adminSessionDays"), 7)),
    };
    if (![0, 0.25, 0.5, 1].includes(data.roundStepHours)) return { error: "Bước làm tròn: 0 / 0,25 / 0,5 / 1 giờ" };
    if (data.roundGraceMinutes >= 30 || data.roundGraceHourMinutes >= 30) return { error: "Dung sai làm tròn phải dưới 30 phút" };
    if (data.faceMatchThreshold < 0.3 || data.faceMatchThreshold > 0.7) return { error: "Ngưỡng khuôn mặt nên trong 0,3–0,7" };
    const before = await Settings.findOne({ key: "main" }).lean();
    await Settings.updateOne({ key: "main" }, { $set: data });
    await audit(adminActor(admin), "settings.config", { type: "Settings" }, before, data);
    // tuỳ chọn: tính lại giờ công (làm tròn) các lượt của tháng này + tháng trước chưa chốt lương
    if (fd.get("recompute") === "on") {
      const { recomputeRounding } = await import("@/lib/attendance");
      await recomputeRounding();
    }
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function disconnectDrive(_: FormState): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng" };
    await Settings.updateOne({ key: "main" }, { $set: { googleRefreshTokenEnc: "", googleAccountEmail: "" } });
    await audit(adminActor(admin), "google.disconnect", { type: "Settings" });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Dọn dữ liệu cũ (chỉ Admin Tổng) ===== */
export type CleanupResult = { ok?: boolean; error?: string; counts?: import("@/lib/cleanup").CleanupCounts };

async function ownerOnly() {
  const admin = await assertAdmin();
  if (admin.kind !== "OWNER") throw new Error("Chỉ Admin Tổng được dọn dữ liệu");
  return admin;
}

/** Đếm mọi loại dữ liệu có thể dọn trước tháng đã chọn (hiện số cạnh từng ô). */
export async function previewAllCleanup(beforeMonth: string): Promise<CleanupResult> {
  try {
    await ownerOnly();
    const { previewCleanup, latestCutoff } = await import("@/lib/cleanup");
    if (!/^\d{4}-\d{2}$/.test(beforeMonth) || beforeMonth > latestCutoff()) return { error: "Tháng không hợp lệ" };
    return { ok: true, counts: await previewCleanup({ beforeMonth }, true) };
  } catch (e) {
    return { error: (e as Error).message || "Lỗi hệ thống" };
  }
}

/** Dung lượng database (so với 512 MB bản miễn phí) + bảng nặng nhất. */
export async function loadStorageStats(): Promise<{ error?: string; stats?: import("@/lib/cleanup").StorageStats }> {
  try {
    await ownerOnly();
    const { getStorageStats } = await import("@/lib/cleanup");
    return { stats: await getStorageStats() };
  } catch (e) {
    return { error: (e as Error).message || "Không đọc được dung lượng" };
  }
}

/** Admin Tổng bật / tắt cả chức năng Nhận hàng (nhân viên + admin). */
export async function saveGoodsEnabled(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được bật / tắt" };
    await connectDB();
    const on = fd.get("goodsEnabled") === "on";
    const stock = fd.get("stockEnabled") === "on";
    await Settings.updateOne({ key: "main" }, { $set: { goodsEnabled: on, stockEnabled: stock } }, { upsert: true });
    await audit(adminActor(admin), "settings.goodsEnabled", { type: "Settings" }, null, { goodsEnabled: on, stockEnabled: stock });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/**
 * Chốt giờ công ca tối – bật / giờ chốt riêng từng cơ sở: Admin Tổng hoặc admin được cấp quyền "attendance.cutoff".
 * Giờ cấm check-in (chung mọi cơ sở): chỉ Admin Tổng – admin khác lưu thì giữ nguyên. Lưu xong chạy ngay 1 lần.
 */
export async function saveAutoCheckout(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("attendance.cutoff");
    const isOwner = admin.kind === "OWNER";
    await connectDB();
    const { Store } = await import("@/lib/models");
    const { isAutoCheckoutTime, runAutoCheckout } = await import("@/lib/auto-checkout");
    const ids = fd.getAll("storeIds").map(String).filter((x) => /^[a-f\d]{24}$/i.test(x));
    const changes: Record<string, { on: boolean; time: string }> = {};
    for (const id of ids) {
      const on = fd.get(`ac_on_${id}`) === "on";
      const time = String(fd.get(`ac_time_${id}`) ?? "").trim() || "23:00";
      if (!isAutoCheckoutTime(time)) return { error: `Giờ tự check-out không hợp lệ (HH:mm): ${time}` };
      await Store.updateOne({ _id: id }, { $set: { autoCheckoutOn: on, autoCheckoutTime: time } });
      changes[id] = { on, time };
    }
    // giờ cấm check-in (mọi cơ sở) – mặc định 01:00–06:00 – chỉ Admin Tổng đổi
    let quiet: { quietCheckinOn: boolean; quietCheckinFrom: string; quietCheckinTo: string } | null = null;
    if (isOwner) {
      quiet = {
        quietCheckinOn: fd.get("quietCheckinOn") === "on",
        quietCheckinFrom: String(fd.get("quietCheckinFrom") ?? "").trim() || "01:00",
        quietCheckinTo: String(fd.get("quietCheckinTo") ?? "").trim() || "06:00",
      };
      if (!isAutoCheckoutTime(quiet.quietCheckinFrom) || !isAutoCheckoutTime(quiet.quietCheckinTo)) return { error: "Giờ cấm check-in không hợp lệ (HH:mm)" };
      if (quiet.quietCheckinOn && quiet.quietCheckinFrom === quiet.quietCheckinTo) return { error: "Giờ cấm check-in: giờ bắt đầu và kết thúc phải khác nhau" };
      await Settings.updateOne({ key: "main" }, { $set: quiet }, { upsert: true });
    }
    await audit(adminActor(admin), "settings.autoCheckout", { type: "Settings" }, null, { stores: changes, ...(quiet ?? {}) });
    if (Object.values(changes).some((c) => c.on)) await runAutoCheckout();
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Thử việc (Admin Tổng): có tháng thử việc (hết tháng hỏi lên 22k) · 3 ca thử việc tính 50% giờ công */
export async function saveProbationConfig(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đổi cấu hình" };
    await connectDB();
    const data = { probationMonthOn: fd.get("probationMonthOn") === "on", probationTrialHalf: fd.get("probationTrialHalf") === "on" };
    await Settings.updateOne({ key: "main" }, { $set: data }, { upsert: true });
    await audit(adminActor(admin), "settings.probation", { type: "Settings" }, null, data);
    // áp ngay hệ số mới cho nhân viên đang làm 3 ca thử việc
    const { User } = await import("@/lib/models");
    const { syncTrial } = await import("@/lib/probation");
    for (const u of await User.find({ probation: true, trialStage: { $in: ["ON", "PENDING"] } }).select("_id").lean()) await syncTrial(u._id);
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Phạt tự động khi đi muộn / bỏ ca / quên chấm công – Admin Tổng. Lưu xong chạy đối soát ngay. */
export async function saveAutoPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đổi cấu hình" };
    await connectDB();
    const money = (k: string) => Math.max(0, Math.round(num(fd.get(k), 0)));
    const on = fd.get("autoPenaltyOn") === "on";
    let from = String(fd.get("autoPenaltyFrom") ?? "").trim();
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return { error: "Ngày áp dụng không hợp lệ" };
    if (on && !from) from = localDate(new Date());
    const data = {
      autoPenaltyOn: on,
      autoPenaltyFrom: from,
      penaltyLateVnd: money("penaltyLateVnd"),
      penaltyLatePerMinVnd: money("penaltyLatePerMinVnd"),
      penaltyNoShowVnd: money("penaltyNoShowVnd"),
      penaltyMissingOutVnd: money("penaltyMissingOutVnd"),
      penaltyMissingInVnd: money("penaltyMissingInVnd"),
    };
    if (on && !data.penaltyLateVnd && !data.penaltyLatePerMinVnd && !data.penaltyNoShowVnd && !data.penaltyMissingOutVnd && !data.penaltyMissingInVnd)
      return { error: "Nhập ít nhất 1 mức phạt (> 0đ)" };
    const before = await Settings.findOne({ key: "main" }).lean();
    await Settings.updateOne({ key: "main" }, { $set: data }, { upsert: true });
    await audit(adminActor(admin), "settings.autoPenalty", { type: "Settings" }, before, data);
    if (on) {
      const { runAutoPenalties } = await import("@/lib/auto-penalty");
      await runAutoPenalties();
    }
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Admin Tổng: cho admin / chính Admin Tổng (có hồ sơ nhân viên) vào app nhân viên. */
export async function saveUserAppAccess(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đổi" };
    await connectDB();
    // quyền vào app nhân viên của từng admin: đặt ở Quản lý admin (AdminAccount.userApp); ở đây chỉ còn Admin Tổng
    const ownerUserApp = fd.get("ownerUserApp") === "on";
    await Settings.updateOne({ key: "main" }, { $set: { ownerUserApp } }, { upsert: true });
    await audit(adminActor(admin), "settings.userAppAccess", { type: "Settings" }, null, { ownerUserApp });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Bật / tắt tự dọn hằng tháng. */
export async function setAutoCleanup(on: boolean): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await ownerOnly();
    await connectDB();
    await Settings.updateOne({ key: "main" }, { $set: { autoCleanup: on } }, { upsert: true });
    await audit(adminActor(admin), "settings.autoCleanup", { type: "Settings" }, null, { autoCleanup: on });
    if (on) {
      const { ensureTtlIndexes } = await import("@/lib/cleanup");
      await ensureTtlIndexes();
    }
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "Lỗi hệ thống" };
  }
}

export async function cleanupData(opts: import("@/lib/cleanup").CleanupOpts, apply: boolean): Promise<CleanupResult> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được dọn dữ liệu" };
    const { previewCleanup, runCleanup } = await import("@/lib/cleanup");
    if (!apply) return { ok: true, counts: await previewCleanup(opts) };
    const counts = await runCleanup(opts);
    // ghi nhật ký SAU khi xoá (để không bị xoá mất)
    await audit(adminActor(admin), "data.cleanup", { type: "Settings" }, null, { opts, counts });
    revalidatePath("/admin/settings");
    return { ok: true, counts };
  } catch (e) {
    return { error: (e as Error).message || "Lỗi hệ thống" };
  }
}
