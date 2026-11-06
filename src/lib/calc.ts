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
  hoursByWage: { hours: number; wage: number }[];
  allowance: number;
  totalBonus: number;
  totalPenalty: number;
  advance: number;
};
/** Thực nhận = Lương cơ bản + Phụ cấp + Thưởng − Phạt − Tạm ứng (VND, số nguyên). */
export function computePay(i: PayrollInput) {
  const totalHours = Math.round(i.hoursByWage.reduce((s, x) => s + x.hours, 0) * 100) / 100;
  const basePay = Math.round(i.hoursByWage.reduce((s, x) => s + x.hours * x.wage, 0));
  const netPay = basePay + i.allowance + i.totalBonus - i.totalPenalty - i.advance;
  return { totalHours, basePay, netPay };
}
