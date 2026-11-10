"use server";
import { revalidatePath } from "next/cache";
import { Settings } from "@/lib/models";
import { connectDB } from "@/lib/db";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { dec, errMsg, num, type FormState } from "./types";

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
