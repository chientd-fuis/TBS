"use server";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/guards";
import { AdminPref } from "@/lib/models";
import { isThemeId } from "@/lib/themes";

/** Admin → Giao diện: màu trang quản lý, lưu theo Gmail admin (đổi máy vẫn giữ). Mỗi admin chọn riêng, không ảnh hưởng người khác. */
export async function setAdminTheme(theme: string): Promise<{ ok?: boolean; error?: string }> {
  try {
    const admin = await assertAdmin();
    if (!isThemeId(theme)) return { error: "Màu không hợp lệ" };
    if (!admin.email) return { error: "Không xác định được Gmail admin" };
    await AdminPref.updateOne({ email: admin.email.toLowerCase() }, { $set: { theme } }, { upsert: true });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
