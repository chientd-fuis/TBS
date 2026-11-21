/*
 * Log lỗi hệ thống – admin theo dõi ở Cài đặt → Log lỗi hệ thống (/admin/settings/errors).
 * Ghi từ:
 *   - mọi server action (nhân viên + admin) qua track(): lỗi trả về {error} (thao tác lỗi) và lỗi văng ra (lỗi hệ thống)
 *   - API (lib/api.ts jsonError), lỗi trang chưa bắt (src/instrumentation.ts), lỗi trình duyệt (/api/client-error)
 *   - Telegram gửi hỏng, cron hằng giờ
 * Lỗi giống nhau (cùng chức năng + nội dung + người) trong 10 phút → gộp 1 dòng, tăng "số lần".
 * Tự xoá sau N ngày (Settings.errorLogDays, mặc định 7) – TTL theo trường expireAt.
 * Chỉ ghi nội dung lỗi – KHÔNG ghi dữ liệu người dùng nhập (mật khẩu, ảnh…).
 */
import { after } from "next/server";
import { headers } from "next/headers";
import { connectDB } from "./db";
import { ErrorLog, Settings, User } from "./models";

export type ErrorLevel = "error" | "warn";
export type ErrorSource = "user" | "admin" | "system" | "client";
export type ErrorEntry = {
  level?: ErrorLevel;
  source?: ErrorSource;
  area?: string;
  fn?: string;
  message: string;
  detail?: string;
  path?: string;
  actorName?: string;
  actorEmail?: string;
  ua?: string;
};

export const ERROR_LOG_DAY_OPTIONS = [1, 3, 7, 14, 30, 60, 90] as const;
export const clampLogDays = (n: unknown) => {
  const d = Math.round(Number(n));
  return Number.isFinite(d) ? Math.min(365, Math.max(1, d)) : 7;
};

let daysCache: { v: number; at: number } | null = null;
export async function errorLogDays() {
  if (daysCache && Date.now() - daysCache.at < 5 * 60_000) return daysCache.v;
  await connectDB();
  const s = await Settings.findOne({ key: "main" }).select("errorLogDays").lean();
  const v = clampLogDays((s as { errorLogDays?: number } | null)?.errorLogDays ?? 7);
  daysCache = { v, at: Date.now() };
  return v;
}
export const forgetErrorLogDays = () => {
  daysCache = null;
};

/** lỗi trả về có vẻ là lỗi hệ thống (DB, mạng, code…) chứ không phải người dùng nhập thiếu / sai */
const SYSTEMISH =
  /lỗi hệ thống|mongo|E11000|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed|timed? ?out|quá giờ|socket|network|Cannot read|is not a function|is not defined|undefined|null|Telegram:|Gemini|AI đang lỗi|Unexpected|ValidationError|CastError|Bad Gateway|HTTP 5\d\d/i;
export const levelOf = (message: string): ErrorLevel => (SYSTEMISH.test(message) ? "error" : "warn");

/** Ghi thẳng vào DB (gộp lỗi trùng trong 10 phút). Không bao giờ ném lỗi. */
export async function writeErrorLog(e: ErrorEntry) {
  try {
    await connectDB();
    const now = new Date();
    const message = String(e.message || "Lỗi không rõ").slice(0, 1000);
    const level = e.level ?? "error";
    const source = e.source ?? "system";
    const key = [level, source, e.area ?? "", e.fn ?? "", message, e.actorEmail ?? ""].join("|").slice(0, 600);
    const expireAt = new Date(now.getTime() + (await errorLogDays()) * 86_400_000);
    const r = await ErrorLog.updateOne(
      { key, lastAt: { $gte: new Date(now.getTime() - 10 * 60_000) } },
      { $inc: { count: 1 }, $set: { lastAt: now, expireAt, ...(e.path ? { path: e.path } : {}) } },
    );
    if (r.matchedCount) return;
    await ErrorLog.create({
      level,
      source,
      area: e.area?.slice(0, 120),
      fn: e.fn?.slice(0, 160),
      message,
      detail: e.detail?.slice(0, 4000),
      path: e.path?.slice(0, 300),
      actorName: e.actorName?.slice(0, 120),
      actorEmail: e.actorEmail?.slice(0, 200),
      ua: e.ua?.slice(0, 300),
      key,
      count: 1,
      createdAt: now,
      lastAt: now,
      expireAt,
    });
  } catch (err) {
    console.error("[error-log] không ghi được log:", (err as Error)?.message, "| lỗi gốc:", e.message);
  }
}

/** trang đang mở (referer) + trình duyệt của request hiện tại */
async function requestInfo(): Promise<{ path?: string; ua?: string }> {
  try {
    const h = await headers();
    const ref = h.get("referer");
    let path: string | undefined;
    if (ref) {
      try {
        const u = new URL(ref);
        path = u.pathname + u.search;
      } catch {
        path = ref;
      }
    }
    return { path, ua: h.get("user-agent") ?? undefined };
  } catch {
    return {};
  }
}

/** ai đang thao tác: admin (trang /admin) hay nhân viên */
async function actorInfo(path?: string): Promise<{ source?: ErrorSource; actorName?: string; actorEmail?: string }> {
  try {
    const { getSessionEmail } = await import("./auth");
    const email = await getSessionEmail();
    if (!email) return {};
    if (path?.startsWith("/admin")) {
      const { getAdmin } = await import("./admin-session");
      const a = await getAdmin().catch(() => null);
      if (a) return { source: "admin", actorName: a.name, actorEmail: email };
    }
    await connectDB();
    const u = await User.findOne({ email }).select("name").lean();
    return { source: path?.startsWith("/admin") ? "admin" : "user", actorName: (u as { name?: string } | null)?.name || email, actorEmail: email };
  } catch {
    return {};
  }
}

/**
 * Ghi log lỗi – chạy SAU khi trả kết quả cho người dùng (không làm chậm thao tác).
 * Tự lấy trang đang mở + người thao tác từ request (nếu đang trong request và chưa truyền vào).
 */
export function logError(e: ErrorEntry) {
  const run = async () => {
    const req = await requestInfo();
    const path = e.path ?? req.path;
    const who = e.actorEmail || e.source === "system" ? {} : await actorInfo(path);
    await writeErrorLog({ ...req, ...who, ...stripUndef(e), message: e.message, path, source: e.source ?? who.source ?? "system" });
  };
  try {
    after(run);
  } catch {
    // ngoài request (script, test…) → ghi luôn
    void run();
  }
}

const stripUndef = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** redirect / notFound của Next là "điều hướng", không phải lỗi */
export function isNextControl(e: unknown) {
  const d = (e as { digest?: unknown } | null)?.digest;
  return typeof d === "string" && /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(d);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e)) || "Lỗi không rõ";

/**
 * Bọc 1 server action: ghi log khi action trả {error: "..."} (thao tác lỗi) hoặc văng lỗi (lỗi hệ thống).
 * Kết quả / lỗi trả về cho người dùng giữ nguyên.
 */
export async function track<T>(area: string, fn: string, run: () => Promise<T>): Promise<T> {
  try {
    const r = await run();
    const msg = r && typeof r === "object" && "error" in r ? (r as { error?: unknown }).error : null;
    if (typeof msg === "string" && msg) logError({ level: levelOf(msg), area, fn, message: msg });
    return r;
  } catch (e) {
    if (isNextControl(e)) throw e;
    logError({ level: "error", area, fn, message: errText(e), detail: e instanceof Error ? e.stack : undefined });
    try {
      (e as { __logged?: boolean }).__logged = true; // instrumentation.ts không ghi trùng
    } catch {
      /* lỗi kiểu string */
    }
    throw e;
  }
}
