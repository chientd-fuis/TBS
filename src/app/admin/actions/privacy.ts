"use server";
import { track } from "@/lib/error-log";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Settings } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { PRIVACY_MAX } from "@/lib/privacy";

type Res = { ok?: boolean; error?: string; version?: number };

/**
 * Lưu Chính sách quyền riêng tư (Admin Tổng).
 *  publish = false: lưu sửa nhỏ, giữ số phiên bản (chưa phát hành thì chỉ là bản nháp – nhân viên chưa thấy).
 *  publish = true : phát hành phiên bản mới → mọi nhân viên phải đồng ý lại trước khi chấm công.
 */
async function savePrivacy__(md: string, publish: boolean): Promise<Res> {
  try {
    const admin = await assertOwner();
    const text = String(md ?? "").replace(/\r\n?/g, "\n").trim();
    if (text.length > PRIVACY_MAX) return { error: `Dài quá – tối đa ${PRIVACY_MAX.toLocaleString("vi-VN")} ký tự` };
    if (publish && text.length < 50) return { error: "Nội dung quá ngắn để phát hành" };
    if (publish && /\[(tên hộ kinh doanh|họ tên, SĐT)/i.test(text)) return { error: "Còn chỗ [ … ] chưa điền (tên quán, người phụ trách) – điền xong mới phát hành" };
    await connectDB();
    const now = new Date();
    const doc = await Settings.findOneAndUpdate(
      { key: "main" },
      publish
        ? { $set: { privacyMd: text, privacyUpdatedAt: now, privacyPublishedAt: now }, $inc: { privacyVersion: 1 } }
        : { $set: { privacyMd: text, privacyUpdatedAt: now } },
      { new: true, upsert: true },
    )
      .select("privacyVersion")
      .lean();
    await audit(adminActor(admin), publish ? "settings.privacy.publish" : "settings.privacy.save", { type: "Settings", id: "privacy" }, null, {
      version: doc?.privacyVersion ?? 0,
      length: text.length,
    });
    revalidatePath("/privacy");
    revalidatePath("/", "layout");
    revalidatePath("/admin/settings/privacy");
    return { ok: true, version: doc?.privacyVersion ?? 0 };
  } catch (e) {
    return { error: (e as Error).message || "Không lưu được" };
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function savePrivacy(...a: Parameters<typeof savePrivacy__>) { return track("Admin › Quyền riêng tư", "savePrivacy", () => savePrivacy__(...a)); }
