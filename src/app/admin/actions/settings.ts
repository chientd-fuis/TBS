"use server";
import { revalidatePath } from "next/cache";
import { Settings } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { dec, errMsg, num, type FormState } from "./types";

/** Cấu hình chấm công (làm tròn, ngưỡng muộn/sớm…) – Chủ. */
export async function saveConfig(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Chủ được đổi cấu hình" };
    const data = {
      roundStepHours: dec(fd.get("roundStepHours"), 0.5),
      roundGraceMinutes: num(fd.get("roundGraceMinutes"), 0),
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
    if (data.faceMatchThreshold < 0.3 || data.faceMatchThreshold > 0.7) return { error: "Ngưỡng khuôn mặt nên trong 0,3–0,7" };
    const before = await Settings.findOne({ key: "main" }).lean();
    await Settings.updateOne({ key: "main" }, { $set: data });
    await audit(adminActor(admin), "settings.config", { type: "Settings" }, before, data);
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function disconnectDrive(_: FormState): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Chủ" };
    await Settings.updateOne({ key: "main" }, { $set: { googleRefreshTokenEnc: "", googleAccountEmail: "" } });
    await audit(adminActor(admin), "google.disconnect", { type: "Settings" });
    revalidatePath("/admin/settings");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
