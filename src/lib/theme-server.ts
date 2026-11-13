import type { Viewport } from "next";
import { getCurrentUser } from "./guards";
import { getAdmin } from "./admin-session";
import { connectDB } from "./db";
import { AdminPref } from "./models";
import { isThemeId, THEMES, themeHeaderColor, themeOf, type ThemeId } from "./themes";

/** generateViewport cho layout app nhân viên / khu Quản lý: màu thanh trạng thái = màu đầu trang theme đang dùng */
export async function themeViewport(): Promise<Viewport> {
  const user = await getCurrentUser().catch(() => null);
  return { themeColor: themeHeaderColor(themeOf(user)) };
}

/** Màu giao diện trang quản lý của admin đang đăng nhập (Admin → Giao diện). Chưa chọn = Vàng bơ. */
export async function adminThemeOf(email?: string | null): Promise<ThemeId> {
  if (!email) return "default";
  await connectDB();
  const p = await AdminPref.findOne({ email: email.toLowerCase() }).select("theme").lean().catch(() => null);
  return isThemeId(p?.theme) ? p.theme : "default";
}

/** generateViewport cho trang admin: thanh trạng thái điện thoại = màu thanh menu admin (theme) */
export async function adminThemeViewport(): Promise<Viewport> {
  const a = await getAdmin().catch(() => null);
  const id = await adminThemeOf(a?.email).catch(() => "default" as ThemeId);
  return { themeColor: THEMES.find((t) => t.id === id)!.nav };
}
