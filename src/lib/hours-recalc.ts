/*
 * TÍNH LẠI GIỜ CÔNG – hàm thuần (không gọi DB), có unit test (tests/hours-recalc.test.ts).
 *
 * Giờ tính công mỗi ca bị làm tròn XUỐNG theo bước (0,5h) → cộng cả tháng, giờ chấm công có thể thấp hơn giờ thực tế vài giờ.
 * Khi giờ thực tế − giờ chấm công > ngưỡng (mặc định 1h):
 *   - tìm các ca bị làm tròn xuống mà chỉ THIẾU ≤ maxShortMin phút (mặc định 23') tới mốc kế tiếp (VD 4h53' → đang tính 4,5, thiếu 7' tới 5h);
 *   - ưu tiên ca thiếu ít phút nhất (rồi ca ngày thường trước ca ngày lễ, rồi ngày sớm hơn);
 *   - mỗi ca cộng 1 bước (+0,5h: 4,5 → 5), dừng NGAY khi chênh còn ≤ ngưỡng → chênh cuối nằm trong (ngưỡng − 0,5h, ngưỡng].
 * Không bao giờ trừ giờ, không cộng làm giờ công vượt giờ thực tế.
 * Bỏ qua: ca thử việc / hệ số < 1, ca admin đã cộng tay (+0,5h), ca có giờ công không khớp giờ vào–ra (đã bị chỉnh tay).
 */
import { roundedHours, type RoundingConfig } from "./calc";

export type RecalcRow = {
  id: string;
  workDate: string;
  checkInAt: Date;
  checkOutAt: Date;
  /** giờ thực tế của lượt (giờ ra − giờ vào) */
  totalHours: number;
  /** giờ tính công CHƯA gồm phần tự cộng */
  base: number;
  payFactor?: number | null;
  extraHours?: number | null;
};

export type RecalcOpts = {
  /** chênh > ngưỡng mới tính, tính tới khi chênh ≤ ngưỡng (giờ) */
  threshold: number;
  /** chỉ cộng ca thiếu tối đa bấy nhiêu phút */
  maxShortMin: number;
  /** ngày lễ (ưu tiên cộng ca ngày thường trước) */
  holidays?: Set<string>;
};

export type RecalcCandidate = { id: string; workDate: string; minutes: number; rounded: number; shortMin: number; holiday: boolean };
export type RecalcPick = RecalcCandidate & { add: number; gapBefore: number; gapAfter: number };

export type RecalcPlan = {
  actual: number;
  /** giờ chấm công (trước khi cộng) */
  before: number;
  /** giờ công sau khi cộng */
  after: number;
  gapBefore: number;
  gapAfter: number;
  added: number;
  /** chênh > ngưỡng → cần tính */
  needed: boolean;
  /** đủ ca để đưa chênh về ≤ ngưỡng */
  enough: boolean;
  picks: RecalcPick[];
  /** mọi ca đủ điều kiện (đã xếp thứ tự ưu tiên) – để xem trước */
  candidates: RecalcCandidate[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-6;

/** Ca bị làm tròn xuống: giờ tính công + số phút còn thiếu tới mốc kế tiếp. Không làm tròn (bước 0) → null. */
export function shortOf(checkInAt: Date, checkOutAt: Date, cfg: RoundingConfig) {
  const stepMin = cfg.stepHours * 60;
  if (stepMin <= 0) return null;
  const minutes = Math.max(0, (checkOutAt.getTime() - checkInAt.getTime()) / 60000);
  const rounded = roundedHours(checkInAt, checkOutAt, cfg);
  // đã được làm tròn LÊN nhờ dung sai → mốc kế tiếp còn ≥ 1 bước → thiếu ≥ 30' (không bao giờ đủ điều kiện)
  const shortMin = Math.ceil(rounded * 60 + stepMin - minutes - EPS);
  return { minutes, rounded, shortMin };
}

/** Lên kế hoạch tính lại cho 1 nhân viên × 1 tháng (các lượt đã check-out). */
export function planRecalc(rows: RecalcRow[], cfg: RoundingConfig, opts: RecalcOpts): RecalcPlan {
  const step = cfg.stepHours;
  // giờ thực tế tính từ giờ vào–ra (chính xác tới giây) – cộng totalHours (đã làm tròn 2 số lẻ từng lượt) dễ lệch 0,01h
  const actual = r2(rows.reduce((s, r) => s + Math.max(0, r.checkOutAt.getTime() - r.checkInAt.getTime()) / 3_600_000, 0));
  const before = r2(rows.reduce((s, r) => s + (r.base || 0), 0));
  const gapBefore = r2(actual - before);
  const candidates: RecalcCandidate[] = [];
  if (step > 0) {
    for (const r of rows) {
      if (r.payFactor != null && r.payFactor < 1) continue; // ca thử việc / bị từ chối (0 giờ)
      if ((r.extraHours || 0) > 0) continue; // admin đã cộng tay
      const s = shortOf(r.checkInAt, r.checkOutAt, cfg);
      if (!s || s.shortMin <= 0 || s.shortMin > opts.maxShortMin) continue;
      if (Math.abs(s.rounded - r.base) > 0.005) continue; // giờ công không khớp giờ vào–ra → đã bị chỉnh, không đụng
      candidates.push({ id: r.id, workDate: r.workDate, minutes: s.minutes, rounded: s.rounded, shortMin: s.shortMin, holiday: !!opts.holidays?.has(r.workDate) });
    }
  }
  candidates.sort((a, b) => a.shortMin - b.shortMin || Number(a.holiday) - Number(b.holiday) || a.workDate.localeCompare(b.workDate) || a.minutes - b.minutes);

  const needed = step > 0 && gapBefore > opts.threshold + EPS;
  const picks: RecalcPick[] = [];
  let gap = gapBefore;
  if (needed) {
    for (const c of candidates) {
      if (gap <= opts.threshold + EPS) break;
      if (gap - step < -EPS) break; // không cộng vượt giờ thực tế
      const next = r2(gap - step);
      picks.push({ ...c, add: step, gapBefore: gap, gapAfter: next });
      gap = next;
    }
  }
  const added = r2(picks.reduce((s, p) => s + p.add, 0));
  return {
    actual,
    before,
    after: r2(before + added),
    gapBefore,
    gapAfter: r2(gapBefore - added),
    added,
    needed,
    enough: !needed || gap <= opts.threshold + EPS,
    picks,
    candidates,
  };
}

/** Lượt đang có phần tự cộng hợp lệ (giờ công = gốc + phần cộng). */
export function autoApplied(a: { roundedHours?: number | null; autoPlus?: number | null; autoBase?: number | null }) {
  const plus = a.autoPlus || 0;
  return plus > 0 && a.autoBase != null && Math.abs((a.roundedHours || 0) - (a.autoBase + plus)) < 0.005;
}

/** Giờ tính công CHƯA gồm phần tự cộng. */
export function baseHours(a: { roundedHours?: number | null; autoPlus?: number | null; autoBase?: number | null }) {
  return autoApplied(a) ? r2(a.autoBase!) : a.roundedHours || 0;
}

/** Ngưỡng / phút thiếu hợp lệ (bước 0,5h): ngưỡng ≥ 1 bước, phút thiếu < 1 bước. */
export const RECALC_THRESHOLDS = [0.5, 1, 1.5, 2] as const;
export const RECALC_MAX_SHORT = [10, 15, 20, 23, 25] as const;
export type RecalcMode = "monthEnd" | "checkout" | "off";
export const RECALC_MODES: { v: RecalcMode; label: string; hint: string }[] = [
  {
    v: "monthEnd",
    label: "23:59 ngày cuối tháng",
    hint: "Tính cả tháng cho mọi nhân viên lúc 23:59 ngày cuối tháng. Ngày 1–4 tháng sau tự tính lại lần nữa (lượt check-out muộn / admin sửa công) trước khi công bố bảng lương. Không gửi thông báo.",
  },
  { v: "checkout", label: "Ngay khi nhân viên check-out", hint: "Mỗi lần check-out / admin chấm hộ, sửa giờ, duyệt yêu cầu: tính lại tháng đó cho riêng nhân viên này – số đỏ cập nhật tức thì." },
  { v: "off", label: "Tắt – chỉ khi admin bấm Tính lại", hint: "Admin tự bấm ở Bảng chấm công → Tính lại giờ công." },
];
/** Giá trị lưu trong Settings → chế độ (trống / giá trị cũ nightly, monthly → mặc định 23:59 cuối tháng). */
export function recalcModeOf(v: unknown): RecalcMode {
  return v === "checkout" || v === "off" ? v : "monthEnd";
}
