import type { Viewport } from "next";
import { getCurrentUser } from "./guards";
import { themeHeaderColor, themeOf } from "./themes";

/** generateViewport cho layout app nhân viên / khu Quản lý: màu thanh trạng thái = màu đầu trang theme đang dùng */
export async function themeViewport(): Promise<Viewport> {
  const user = await getCurrentUser().catch(() => null);
  return { themeColor: themeHeaderColor(themeOf(user)) };
}
