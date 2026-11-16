"use server";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { Announcement, AnnouncementSeen } from "@/lib/models";
import { isYmd } from "@/lib/time";

export type AnnInput = {
  id?: string;
  title: string;
  date: string;
  desc: string;
  points: string[];
  color: string;
  image?: string;
  ctaHref?: string;
  audience: "USER" | "ADMIN" | "ALL";
  storeIds: string[];
  /** draft = lưu nháp · publish = đăng (hiện cho người chưa xem) · republish = đăng + hiện lại cho tất cả */
  op: "draft" | "publish" | "republish";
};

const done = () => {
  revalidatePath("/admin/settings/announcements");
  revalidatePath("/", "layout");
};

/** Cài đặt → Có gì mới: lưu nháp / đăng / hiện lại cho tất cả (Admin Tổng). */
export async function saveAnnouncement(input: AnnInput): Promise<{ ok?: boolean; error?: string; id?: string }> {
  try {
    const admin = await assertOwner();
    await connectDB();
    const title = String(input.title ?? "").trim().slice(0, 80);
    if (!title) return { error: "Nhập tiêu đề" };
    if (!isYmd(input.date)) return { error: "Ngày cập nhật không hợp lệ" };
    const image = typeof input.image === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(input.image) && input.image.length < 600_000 ? input.image : "";
    if (input.image && !image && !/^\/|^https?:/.test(input.image)) return { error: "Ảnh quá lớn – chọn ảnh khác" };
    const ctaHref = String(input.ctaHref ?? "").trim();
    const data = {
      title,
      date: input.date,
      desc: String(input.desc ?? "").trim().slice(0, 300),
      points: (Array.isArray(input.points) ? input.points : []).map((p) => String(p).trim().slice(0, 120)).filter(Boolean).slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : "#fccc18",
      image: image || (input.image && /^\/|^https?:/.test(input.image) ? input.image : ""),
      ctaHref: ctaHref.startsWith("/") ? ctaHref.slice(0, 200) : "",
      audience: ["USER", "ADMIN", "ALL"].includes(input.audience) ? input.audience : "USER",
      storeIds: (Array.isArray(input.storeIds) ? input.storeIds : []).filter((s) => isValidObjectId(s)),
    };
    const old = input.id && isValidObjectId(input.id) ? await Announcement.findById(input.id) : null;
    const doc = old ?? new Announcement({ createdBy: adminActor(admin).name });
    doc.set(data);
    if (input.op === "draft") {
      if (doc.status !== "PUBLISHED") doc.set("status", "DRAFT");
    } else {
      if (doc.status !== "PUBLISHED" || !doc.publishedAt) doc.set("publishedAt", new Date());
      doc.set("status", "PUBLISHED");
      if (input.op === "republish" && old) doc.set("version", (doc.version ?? 1) + 1); // người đã xem bản cũ thấy lại
    }
    await doc.save();
    await audit(adminActor(admin), `announcement.${input.op}`, { type: "Announcement", id: String(doc._id) }, null, { title });
    done();
    return { ok: true, id: String(doc._id) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Tắt (ngừng hiện) / bật lại / xoá */
export async function setAnnouncementStatus(id: string, op: "off" | "on" | "delete"): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await assertOwner();
    await connectDB();
    if (!isValidObjectId(id)) return { error: "Không tìm thấy" };
    if (op === "delete") {
      await Announcement.deleteOne({ _id: id });
      await AnnouncementSeen.deleteMany({ announcementId: id });
    } else await Announcement.updateOne({ _id: id }, { $set: { status: op === "off" ? "OFF" : "PUBLISHED" } });
    await audit(adminActor(admin), `announcement.${op}`, { type: "Announcement", id }, null, null);
    done();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
