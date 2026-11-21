import { NextResponse } from "next/server";
import { levelOf, logError } from "./error-log";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
    /** chi tiết kỹ thuật – chỉ ghi vào Log lỗi hệ thống, không gửi cho người dùng */
    public detail?: string,
  ) {
    super(message);
  }
}

/** Trả lỗi JSON cho API + ghi Log lỗi hệ thống (req để biết API nào). 4xx = thao tác lỗi, 5xx / lỗi lạ = lỗi hệ thống. */
export function jsonError(e: unknown, req?: Request) {
  const fn = req ? `${req.method} ${new URL(req.url).pathname}` : "API";
  const area = req ? apiArea(new URL(req.url).pathname) : "API";
  if (e instanceof HttpError) {
    const message = e.detail ? `${e.message} – ${e.detail}` : e.message;
    logError({ level: e.status >= 500 ? "error" : levelOf(message), area, fn, message: `[${e.status}] ${message}` });
    return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  }
  console.error(e);
  logError({ level: "error", area, fn, message: (e as Error)?.message || String(e), detail: (e as Error)?.stack });
  return NextResponse.json({ error: (e as Error).message || "Lỗi hệ thống" }, { status: 500 });
}

export function dataUrlToBuffer(dataUrl: string) {
  const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new HttpError(400, "Ảnh không hợp lệ");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 1.5 * 1024 * 1024) throw new HttpError(400, "Ảnh quá lớn");
  return buf;
}

/** tên chức năng dễ đọc cho Log lỗi theo đường dẫn API */
const API_AREAS: [string, string][] = [
  ["/api/attendance", "Chấm công (NV)"],
  ["/api/closing/ocr", "Đọc ảnh chốt ca bằng AI (NV)"],
  ["/api/closing", "Chốt ca (NV)"],
  ["/api/goods/read", "Đọc ảnh / tin nhận hàng bằng AI"],
  ["/api/device", "Thiết bị (NV)"],
  ["/api/onboarding", "Đăng ký hồ sơ (NV)"],
  ["/api/admin/attendance/import", "Admin › Nhập chấm công"],
  ["/api/admin/attendance/ocr", "Admin › Đọc ảnh chấm công bằng AI"],
  ["/api/admin/closing/ocr", "Admin › Đọc ảnh chốt ca bằng AI"],
  ["/api/admin/closing", "Admin › Chốt ca"],
  ["/api/admin/expenses/ocr", "Admin › Đọc ảnh hoá đơn bằng AI"],
  ["/api/admin/expenses", "Admin › Chi phí"],
  ["/api/cron", "Tự động (cron)"],
];
export const apiArea = (path: string) => API_AREAS.find(([p]) => path.startsWith(p))?.[1] ?? `API ${path}`;
