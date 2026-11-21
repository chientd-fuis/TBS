/* Next.js gọi onRequestError khi trang / API / server action văng lỗi chưa được bắt → ghi Log lỗi hệ thống. */

type Req = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type Ctx = { routerKind: string; routePath: string; routeType: string; renderSource?: string };

export async function onRequestError(err: unknown, request: Req, context: Ctx) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    if ((err as { __logged?: boolean } | null)?.__logged) return; // track() đã ghi rồi
    const { isNextControl, writeErrorLog } = await import("./lib/error-log");
    if (isNextControl(err)) return;
    const path = request.path || context.routePath;
    const kind = context.routeType === "route" ? "API" : context.routeType === "action" ? "Thao tác" : context.routeType === "middleware" ? "Middleware" : "Trang";
    const ua = request.headers["user-agent"];
    const digest = (err as { digest?: string } | null)?.digest;
    await writeErrorLog({
      level: "error",
      source: path.startsWith("/api/cron") ? "system" : path.startsWith("/admin") || path.startsWith("/api/admin") ? "admin" : "user",
      area: `${kind} ${context.routePath}`,
      fn: `${request.method} ${path.split("?")[0]}`,
      message: (err instanceof Error ? err.message : String(err)) + (digest ? ` (mã ${digest})` : ""),
      detail: err instanceof Error ? err.stack : undefined,
      path,
      ua: Array.isArray(ua) ? ua[0] : ua,
    });
  } catch (e) {
    console.error("[instrumentation] không ghi được log lỗi", e);
  }
}
