import { Types } from "mongoose";
import { connectDB } from "./db";
import { Announcement, AnnouncementSeen } from "./models";

/*
 * CÓ GÌ MỚI – popup giới thiệu tính năng mới.
 *  - Admin soạn ở Cài đặt → Có gì mới, bấm Đăng → hiện cho người CHƯA xem (theo tài khoản, đổi máy không hiện lại).
 *  - 1 bản chưa xem → popup; 2+ bản → slide (mới nhất trước, tối đa 5).
 *  - Người vào làm SAU ngày đăng không thấy các bản cũ hơn ngày họ vào.
 *  - "Hiện lại cho tất cả" → tăng version → người đã xem bản cũ thấy lại.
 */

import { ANN_COLORS } from "./announce-colors";
export { ANN_COLORS };
export const MAX_SLIDES = 5;

export type AnnItem = { id: string; title: string; date: string; desc: string; points: string[]; color: string; image?: string; ctaHref?: string; version: number };

const toItem = (a: {
  _id: unknown;
  title: string;
  date: string;
  desc?: string | null;
  points?: string[] | null;
  color?: string | null;
  image?: string | null;
  ctaHref?: string | null;
  version?: number | null;
}): AnnItem => ({
  id: String(a._id),
  title: a.title,
  date: a.date,
  desc: a.desc ?? "",
  points: (a.points ?? []).filter(Boolean).slice(0, 4),
  color: a.color || ANN_COLORS[0],
  image: a.image || undefined,
  ctaHref: a.ctaHref || undefined,
  version: a.version ?? 1,
});

/** Các bản đang hiện cho 1 người (mới nhất trước). who = "user:<id>" | "admin:<gmail>" */
export async function publishedFor(opts: { kind: "USER" | "ADMIN"; storeId?: unknown; since?: Date | null }) {
  await connectDB();
  const q: Record<string, unknown> = { status: "PUBLISHED", audience: { $in: [opts.kind, "ALL"] } };
  if (opts.since) q.publishedAt = { $gte: opts.since };
  const list = await Announcement.find(q).sort({ publishedAt: -1, date: -1 }).limit(30).lean();
  return list.filter((a) => opts.kind === "ADMIN" || !(a.storeIds ?? []).length || (a.storeIds ?? []).some((s: unknown) => String(s) === String(opts.storeId))).map(toItem);
}

/** Các bản người này CHƯA xem (hoặc admin bấm "Hiện lại cho tất cả" sau khi họ xem) – tối đa 5 bản mới nhất */
export async function unseenFor(who: string, opts: Parameters<typeof publishedFor>[0]) {
  const list = await publishedFor(opts);
  if (!list.length) return [];
  const seen = await AnnouncementSeen.find({ who, announcementId: { $in: list.map((a) => new Types.ObjectId(a.id)) } })
    .select("announcementId version")
    .lean();
  const ver = new Map(seen.map((s) => [String(s.announcementId), s.version ?? 1]));
  return list.filter((a) => (ver.get(a.id) ?? 0) < a.version).slice(0, MAX_SLIDES);
}

export async function markSeen(who: string, items: { id: string; version: number }[], action: string) {
  await connectDB();
  for (const it of items.slice(0, 20)) {
    if (!Types.ObjectId.isValid(it.id)) continue;
    await AnnouncementSeen.updateOne(
      { announcementId: it.id, who },
      { $set: { version: Math.max(1, Math.round(Number(it.version) || 1)), action: action.slice(0, 10) } },
      { upsert: true },
    );
  }
}
