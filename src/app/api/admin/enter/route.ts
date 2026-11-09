import { NextResponse } from "next/server";
import { startAdminSession } from "@/lib/admin-enter";

export const dynamic = "force-dynamic";

/**
 * Tự vào trang quản lý sau khi đăng nhập Google (trang /admin/login chuyển tới đây):
 * Gmail là admin đang hoạt động → tạo phiên rồi vào /admin; không thì quay lại trang đăng nhập (hiện lý do).
 */
export async function GET(req: Request) {
  const r = await startAdminSession();
  return NextResponse.redirect(new URL(r.ok ? "/admin" : "/admin/login?denied=1", req.url));
}
