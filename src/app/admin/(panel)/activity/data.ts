import { connectDB } from "@/lib/db";
import { ACTIVITY_DAYS, AdminActivity, AdminLoginSession } from "@/lib/models";
import { actionMeta, actionsOf, type ActivityGroup } from "@/lib/activity";
import { addDays, localDate, zonedToDate } from "@/lib/time";
import { parseUA } from "@/lib/device";

export type ActivityRow = { id: string; at: string; day: string; time: string; admin: string; action: string; label: string; group: ActivityGroup; summary: string };

const vnDay = (d: Date) => localDate(d);
const vnHm = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(11, 16);

/** 7 ngày gần nhất (hôm nay trước). */
export function activityDays(now = new Date()) {
  const today = localDate(now);
  return Array.from({ length: ACTIVITY_DAYS }, (_, i) => addDays(today, -i));
}

export async function loadActivities(opts: { days: string[]; admin?: string; group?: ActivityGroup; limit?: number }): Promise<ActivityRow[]> {
  await connectDB();
  const sorted = [...opts.days].sort();
  if (!sorted.length) return [];
  const q: Record<string, unknown> = {
    createdAt: { $gte: zonedToDate(sorted[0], "00:00"), $lt: zonedToDate(addDays(sorted[sorted.length - 1], 1), "00:00") },
  };
  if (opts.admin) q.adminName = opts.admin;
  if (opts.group) q.action = { $in: actionsOf(opts.group) };
  const rows = await AdminActivity.find(q).sort({ createdAt: -1 }).limit(opts.limit ?? 1000).lean();
  const want = new Set(opts.days);
  return rows
    .map((r) => {
      const m = actionMeta(r.action ?? "");
      return { id: String(r._id), at: r.createdAt.toISOString(), day: vnDay(r.createdAt), time: vnHm(r.createdAt), admin: r.adminName ?? "?", action: r.action ?? "", label: m.label, group: m.group, summary: r.summary ?? "" };
    })
    .filter((r) => want.has(r.day));
}

/** Tên các admin có hoạt động trong 7 ngày. */
export async function activityAdmins() {
  await connectDB();
  return ((await AdminActivity.distinct("adminName")) as string[]).filter(Boolean).sort((a, b) => a.localeCompare(b, "vi"));
}

export type SessionRow = { sid: string; name: string; ip: string; device: string; createdAt: string; lastSeenAt: string; online: boolean };
export const ONLINE_MS = 5 * 60_000;

/** Phiên admin còn hiệu lực (chưa đăng xuất, chưa hết hạn), mới hoạt động nhất trước. */
export async function loadSessions(): Promise<SessionRow[]> {
  await connectDB();
  const now = Date.now();
  const list = await AdminLoginSession.find({ revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean();
  return list.map((s) => {
    const ua = parseUA(s.userAgent ?? "");
    return {
      sid: s.sid,
      name: s.name ?? "?",
      ip: s.ip ?? "",
      device: [ua.model || ua.os, ua.browser].filter((x) => x && x !== "Khác").join(" · ") || "Không rõ",
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: (s.lastSeenAt ?? s.createdAt).toISOString(),
      online: now - (s.lastSeenAt ?? s.createdAt).getTime() < ONLINE_MS,
    };
  });
}
