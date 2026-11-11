/** Hình thức lương (part-time theo giờ / full-time lương cứng) – thuần tuý, có unit test (tests/salary.test.ts). */

export type PayType = "HOURLY" | "FULLTIME";
export const PAY_TYPES: { value: PayType; label: string; short: string }[] = [
  { value: "HOURLY", label: "Part-time (lương giờ)", short: "Part-time" },
  { value: "FULLTIME", label: "Full-time (lương cứng / tháng)", short: "Full-time" },
];
export const isPayType = (v: unknown): v is PayType => v === "HOURLY" || v === "FULLTIME";

export type PayTerms = { payType: PayType; monthlySalary: number; paidLeaveDays: number };
type SalaryRow = { payType?: string | null; monthlySalary?: number | null; paidLeaveDays?: number | null; effectiveMonth: string; createdAt?: Date | null };

/**
 * Hình thức lương áp dụng cho tháng `month` (YYYY-MM): mốc mới nhất có effectiveMonth ≤ month
 * (cùng tháng → mốc tạo sau thắng). Chưa có mốc nào → lương giờ.
 */
export function payTermsAt(history: SalaryRow[], month: string): PayTerms {
  let best: SalaryRow | null = null;
  for (const h of history) {
    if (h.effectiveMonth > month) continue;
    if (
      !best ||
      h.effectiveMonth > best.effectiveMonth ||
      (h.effectiveMonth === best.effectiveMonth && (h.createdAt?.getTime() ?? 0) >= (best.createdAt?.getTime() ?? 0))
    )
      best = h;
  }
  if (!best || best.payType !== "FULLTIME") return { payType: "HOURLY", monthlySalary: 0, paidLeaveDays: 0 };
  return { payType: "FULLTIME", monthlySalary: Math.max(0, Math.round(best.monthlySalary ?? 0)), paidLeaveDays: Math.max(0, best.paidLeaveDays ?? 0) };
}

/** Số ngày của tháng YYYY-MM. */
export function daysOfMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Tiền nghỉ không lương (full-time) = lương cứng / (số ngày trong tháng − số ngày nghỉ có lương) × số ngày nghỉ không lương.
 * null khi không tính được (số ngày công chuẩn ≤ 0).
 */
export function unpaidLeaveAmount(monthlySalary: number, daysInMonth: number, paidLeaveDays: number, unpaidDays: number) {
  const workDays = daysInMonth - paidLeaveDays;
  if (!(workDays > 0) || !(unpaidDays > 0)) return null;
  return Math.round((monthlySalary / workDays) * unpaidDays);
}

/** Gợi ý số ngày nghỉ không lương = số ngày không đi làm − số ngày nghỉ có lương (không âm). */
export function suggestUnpaidDays(daysInMonth: number, workDays: number, paidLeaveDays: number) {
  return Math.max(0, daysInMonth - workDays - paidLeaveDays);
}
