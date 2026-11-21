import { NextResponse } from "next/server";
import { logError } from "@/lib/error-log";

/** Lỗi trình duyệt gửi về (components/ErrorReporter.tsx) → Log lỗi hệ thống. Giới hạn 30 lỗi / 10 phút / IP để không bị spam. */
const hits = new Map<string, number[]>();

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (list.length >= 30) return new NextResponse(null, { status: 204 });
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  const b = (await req.json().catch(() => null)) as { message?: unknown; stack?: unknown; path?: unknown } | null;
  const message = typeof b?.message === "string" ? b.message.slice(0, 500) : "";
  if (!message) return new NextResponse(null, { status: 204 });
  const path = typeof b?.path === "string" ? b.path.slice(0, 300) : undefined;
  logError({
    level: "error",
    area: path?.startsWith("/admin") ? "Trình duyệt (admin)" : "Trình duyệt (NV)",
    fn: "Lỗi giao diện",
    message,
    detail: typeof b?.stack === "string" ? b.stack.slice(0, 3000) : undefined,
    path,
  });
  return new NextResponse(null, { status: 204 });
}
