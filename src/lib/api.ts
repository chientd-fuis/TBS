import { NextResponse } from "next/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function jsonError(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: (e as Error).message || "Lỗi hệ thống" }, { status: 500 });
}

export function dataUrlToBuffer(dataUrl: string) {
  const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(dataUrl || "");
  if (!m) throw new HttpError(400, "Ảnh không hợp lệ");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 1.5 * 1024 * 1024) throw new HttpError(400, "Ảnh quá lớn");
  return buf;
}
