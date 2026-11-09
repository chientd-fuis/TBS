"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { AdminLoginSession } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";

/** Admin Tổng đăng xuất 1 phiên admin (sid) hoặc tất cả (sid = "ALL"). Admin bị đăng xuất ngay ở lần bấm tiếp theo. */
export async function revokeAdminSession(sid: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await assertAdmin();
    if (admin.kind !== "OWNER") return { error: "Chỉ Admin Tổng được đăng xuất phiên admin" };
    await connectDB();
    const q = sid === "ALL" ? { revokedAt: null } : { sid, revokedAt: null };
    const list = await AdminLoginSession.find(q).select("name").lean();
    const r = await AdminLoginSession.updateMany(q, { $set: { revokedAt: new Date(), revokedBy: "Admin Tổng" } });
    await audit(adminActor(admin), "admin.session.revoke", { type: "AdminLoginSession", id: sid }, null, { names: list.map((l) => l.name), n: r.modifiedCount });
    revalidatePath("/admin/activity");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "Lỗi hệ thống" };
  }
}
