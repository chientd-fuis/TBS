/** Các công thức tính giờ công – thuần tuý, có unit test (tests/calc.test.ts). */

export type RoundingConfig = { stepHours: number; graceMinutes: number };

/** Tổng giờ (thập phân, 2 chữ số) giữa 2 mốc. */
export function totalHours(checkIn: Date, checkOut: Date) {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(0, Math.round((ms / 3_600_000) * 100) / 100);
}

/** hh:mm từ khoảng thời gian (làm tròn xuống phút). */
export function formatDuration(checkIn: Date, checkOut: Date) {
  const totalMin = Math.max(0, Math.floor((checkOut.getTime() - checkIn.getTime()) / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Giờ tính công: làm tròn XUỐNG theo bước (mặc định 0,5h).
 * graceMinutes: dung sai (mặc định 0) – VD 5 → 14h55' được tính 15h.
 * VD: 4h45' → 4,5 ; 5h10' → 5 ; 13h41' → 13,5
 */
export function roundedHours(checkIn: Date, checkOut: Date, cfg: RoundingConfig) {
  const minutes = Math.max(0, (checkOut.getTime() - checkIn.getTime()) / 60000);
  const stepMin = cfg.stepHours * 60;
  if (stepMin <= 0) return Math.round((minutes / 60) * 100) / 100;
  const steps = Math.floor((minutes + cfg.graceMinutes) / stepMin + 1e-9);
  return Math.round(steps * cfg.stepHours * 100) / 100;
}

/** Số phút đi muộn (0 nếu trong ngưỡng cho phép). */
export function lateMinutes(checkIn: Date, shiftStart: Date, thresholdMin: number) {
  const diff = Math.floor((checkIn.getTime() - shiftStart.getTime()) / 60000);
  return diff > thresholdMin ? diff : 0;
}
/** Số phút về sớm (0 nếu trong ngưỡng cho phép). */
export function earlyMinutes(checkOut: Date, shiftEnd: Date, thresholdMin: number) {
  const diff = Math.floor((shiftEnd.getTime() - checkOut.getTime()) / 60000);
  return diff > thresholdMin ? diff : 0;
}

/** Khoảng cách 2 toạ độ (mét) – Haversine. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Khoảng cách Euclid giữa 2 face descriptor (128 chiều). < ngưỡng (≈0.5) là cùng người. */
export function faceDistance(a: number[], b: number[]) {
  if (a.length !== b.length || a.length === 0) return Infinity;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

export type PayrollInput = {
  /** mult: hệ số lương (ngày lễ ×2, ×3…; mặc định 1) */
  hoursByWage: { hours: number; wage: number; mult?: number }[];
  allowance: number;
  totalBonus: number;
  totalPenalty: number;
  advance: number;
};
/** Thực nhận = Lương cơ bản + Phụ cấp + Thưởng − Phạt − Tạm ứng (VND, số nguyên). */
export function computePay(i: PayrollInput) {
  const totalHours = Math.round(i.hoursByWage.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const basePay = Math.round(i.hoursByWage.reduce((s, x) => s + x.hours * x.wage * (x.mult ?? 1), 0));
  const netPay = basePay + i.allowance + i.totalBonus - i.totalPenalty - i.advance;
  // ngày lễ: số giờ + tiền cộng thêm (đã nằm trong basePay)
  const hol = i.hoursByWage.filter((x) => (x.mult ?? 1) > 1);
  const holidayHours = Math.round(hol.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const holidayExtra = Math.round(hol.reduce((s, x) => s + x.hours * x.wage * ((x.mult ?? 1) - 1), 0));
  return { totalHours, basePay, netPay, holidayHours, holidayExtra };
}

/* ---------- Làm liền nhiều ca (VD ca 1 + ca 2: vào đầu ca 1, ra cuối ca 2) ---------- */
export type Segment = { start: Date; end: Date; name?: string | null };

/** Khoảng nghỉ tối đa giữa 2 ca để coi là làm liền (phút). */
export const CONTIGUOUS_GAP_MIN = 30;

/**
 * Gộp ca gốc với các ca liền kề phía sau (ca sau bắt đầu trước khi ca trước kết thúc + gapMin).
 * Trả về khối ca liền: start = đầu ca gốc, end = cuối ca liền cuối cùng, segments theo thứ tự.
 */
export function mergeShiftBlock(base: Segment, others: Segment[], gapMin = CONTIGUOUS_GAP_MIN) {
  const segments: Segment[] = [base];
  let end = base.end;
  const rest = [...others].filter((o) => o.start.getTime() > base.start.getTime()).sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const o of rest) {
    if (o.start.getTime() > end.getTime() + gapMin * 60000) break; // có khoảng nghỉ dài → hết khối
    if (o.end.getTime() <= end.getTime()) continue; // ca nằm trong khối (trùng giờ)
    segments.push(o);
    end = o.end;
  }
  return { start: base.start, end, segments };
}

/**
 * Về sớm khi làm nhiều ca liền: so với GIỜ KẾT THÚC của ca đang làm lúc check-out.
 * - Ra cuối ca 2 (hoặc muộn hơn)            → 0
 * - Ra đúng hết ca 1 (nghỉ, check-in lại ca 2) → 0
 * - Ra giữa ca 2                             → số phút còn thiếu của ca 2
 * Check-out ở khoảng nghỉ giữa 2 ca → 0.
 */
export function earlyMinutesInBlock(checkOut: Date, segments: Segment[], thresholdMin: number) {
  const t = checkOut.getTime();
  // (start, end]: ra đúng giờ hết ca 1 → thuộc ca 1 → không tính về sớm của ca 2
  const seg = segments.find((s) => t > s.start.getTime() && t <= s.end.getTime());
  return seg ? earlyMinutes(checkOut, seg.end, thresholdMin) : 0;
}
