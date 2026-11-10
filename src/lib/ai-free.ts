/*
 * Đếm lượt gói MIỄN PHÍ Gemini cho đúng cách Google tính:
 *  - Hạn mức tính theo PROJECT Google (mỗi API key = 1 project), riêng TỪNG MODEL – không phải theo app / theo tháng.
 *  - Lượt / ngày (RPD) reset lúc 0h giờ Mỹ (Pacific) = 15h giờ VN (mùa hè Mỹ: 14h).
 *  - Mỗi lần gọi API đều tính 1 lượt, kể cả lần thử lại / chuyển model dự phòng / lỗi – trừ lần bị từ chối vì hết lượt (429).
 * App ghi từng lần gọi (AiCall) theo key + model + ngày giờ Mỹ. Hạn mức free mỗi model thì Google đổi liên tục
 * → Admin Tổng nhập theo trang AI Studio → Rate limits (không tự đoán).
 */
import { createHash } from "node:crypto";
import { AiCall } from "./models";
import { addDays, localDate, localTime, zonedToDate } from "./time";

export const GOOGLE_TZ = "America/Los_Angeles";
/** Ngày tính lượt của Google (giờ Pacific) */
export const googleDay = (now = new Date()) => localDate(now, GOOGLE_TZ);
/** Mã nhận diện key (không lưu key thật) */
export const keyTag = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 10);
/** Lúc Google reset lượt ngày, theo giờ VN ("15:00 hôm nay") */
export function nextResetVi(now = new Date()) {
  const at = zonedToDate(addDays(googleDay(now), 1), "00:00", GOOGLE_TZ);
  const sameDay = localDate(at) === localDate(now);
  return `${localTime(at).slice(0, 5)} ${sameDay ? "hôm nay" : "ngày mai"}`;
}

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };

/** Ghi 1 lần gọi API. status: 200 OK · 429 hết lượt (không tính lượt, chỉ đánh dấu) · khác = lỗi (vẫn tính lượt) · 0 = quá giờ. */
export async function recordAiCall(key: string, model: string, status: number, body?: unknown, perDay = false) {
  const u = ((body as { usageMetadata?: Usage } | undefined)?.usageMetadata ?? {}) as Usage;
  await AiCall.create({
    day: googleDay(),
    keyTag: keyTag(key),
    model,
    status,
    perDay: status === 429 ? perDay : undefined,
    tokens: u.totalTokenCount ?? 0,
    inTokens: u.promptTokenCount ?? 0,
    outTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  }).catch(() => null);
}

export type FreeRow = { keyTag: string; model: string; used: number; errors: number; tokens: number; lastMin: number; blockedToday: boolean };

/** Lượt hôm nay (ngày Google) theo key × model. */
export async function freeUsageToday(now = new Date()): Promise<FreeRow[]> {
  const day = googleDay(now);
  const minAgo = new Date(now.getTime() - 60_000);
  const rows = await AiCall.aggregate<{ _id: { k: string; m: string }; used: number; errors: number; tokens: number; lastMin: number; blocked: number }>([
    { $match: { day } },
    {
      $group: {
        _id: { k: "$keyTag", m: "$model" },
        used: { $sum: { $cond: [{ $ne: ["$status", 429] }, 1, 0] } },
        errors: { $sum: { $cond: [{ $and: [{ $ne: ["$status", 429] }, { $ne: ["$status", 200] }] }, 1, 0] } },
        tokens: { $sum: "$tokens" },
        lastMin: { $sum: { $cond: [{ $and: [{ $ne: ["$status", 429] }, { $gte: ["$createdAt", minAgo] }] }, 1, 0] } },
        blocked: { $sum: { $cond: [{ $and: [{ $eq: ["$status", 429] }, { $eq: ["$perDay", true] }] }, 1, 0] } },
      },
    },
  ]);
  return rows.map((r) => ({ keyTag: r._id.k, model: r._id.m, used: r.used, errors: r.errors, tokens: r.tokens, lastMin: r.lastMin, blockedToday: r.blocked > 0 }));
}
