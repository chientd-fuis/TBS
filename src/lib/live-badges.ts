/*
 * Badge cho nhân viên ĐANG LÀM (chưa check-out) ở Tổng quan:
 *  - "Mới đến":      vào trong khoảng 30 phút trước → 15 phút sau giờ bắt đầu ca (hiện trong 30 phút đầu sau khi vào)
 *  - "Làm thêm giờ": vào sớm hơn giờ bắt đầu ca > 30 phút, hoặc đã quá giờ hết ca (ca cuối liền mạch) > 30 phút
 *  - "Sắp hết ca":   còn ≤ 45 phút là hết ca và ca kế tiếp không có lịch làm tiếp
 * Hàm thuần – có unit test. Số phút ≥ 60 hiện dạng giờ: 90 → "1h30'".
 */
import { minutesVi } from "./format";

/** khung giờ ca (ms) */
export type Win = { start: number; end: number };
export type LiveBadge = { kind: "new" | "ending" | "overtime"; text: string };

const MIN = 60_000;
/** ms → "45'" / "1h30'" (từ 60 phút đổi sang giờ) */
const mins = (ms: number) => minutesVi(Math.max(1, Math.round(ms / MIN)));

/**
 * @param assigned ca được xếp hôm nay của nhân viên ở cơ sở này
 * @param templates các ca của cơ sở hôm nay (dùng khi nhân viên không có lịch – làm thêm ca)
 */
export function liveBadges(checkIn: number, now: number, assigned: Win[], templates: Win[]): LiveBadge[] {
  const cand = (assigned.length ? assigned : templates).slice().sort((a, b) => a.start - b.start);
  if (!cand.length) return [];
  // ca nhân viên đến làm: ca có [giờ bắt đầu, giờ hết − 30'] gần giờ vào nhất (12:51 → ca Chiều 13h, không phải ca Sáng hết 13h)
  const dist = (w: Win) => (checkIn < w.start ? w.start - checkIn : checkIn > w.end - 30 * MIN ? checkIn - (w.end - 30 * MIN) : 0);
  const target = cand.reduce((best, w) => (dist(w) < dist(best) ? w : best));
  // làm liền các ca có lịch nối tiếp (hết ca này là vào ca sau) → giờ hết = hết ca cuối
  let end = target.end;
  for (const w of assigned.slice().sort((a, b) => a.start - b.start)) if (w.start > target.start && w.start <= end + 5 * MIN && w.end > end) end = w.end;

  const out: LiveBadge[] = [];
  const early = target.start - checkIn;
  if (early > 30 * MIN) out.push({ kind: "overtime", text: `Làm thêm giờ · đến sớm ${mins(early)}` });
  else if (early >= -15 * MIN && now - checkIn <= 30 * MIN) out.push({ kind: "new", text: "Mới đến" });
  const left = end - now;
  if (left > 0 && left <= 45 * MIN) out.push({ kind: "ending", text: `Sắp hết ca · còn ${mins(left)}` });
  if (-left > 30 * MIN) out.push({ kind: "overtime", text: `Làm thêm giờ · quá ca ${mins(-left)}` });
  return out;
}
