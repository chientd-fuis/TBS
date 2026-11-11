import { test } from "node:test";
import assert from "node:assert/strict";
import { daysOfMonth, payTermsAt, suggestUnpaidDays, unpaidLeaveAmount } from "../src/lib/salary";
import { computePay } from "../src/lib/calc";

test("payTermsAt: chưa có mốc → lương giờ", () => {
  assert.deepEqual(payTermsAt([], "2026-11"), { payType: "HOURLY", monthlySalary: 0, paidLeaveDays: 0 });
});

test("payTermsAt: lấy mốc mới nhất ≤ tháng", () => {
  const h = [
    { payType: "FULLTIME", monthlySalary: 8_000_000, effectiveMonth: "2026-09" },
    { payType: "FULLTIME", monthlySalary: 9_000_000, effectiveMonth: "2026-11" },
    { payType: "HOURLY", monthlySalary: 0, effectiveMonth: "2027-01" },
  ];
  assert.deepEqual(payTermsAt(h, "2026-08"), { payType: "HOURLY", monthlySalary: 0, paidLeaveDays: 0 });
  assert.deepEqual(payTermsAt(h, "2026-10"), { payType: "FULLTIME", monthlySalary: 8_000_000, paidLeaveDays: 0 });
  assert.deepEqual(payTermsAt(h, "2026-12"), { payType: "FULLTIME", monthlySalary: 9_000_000, paidLeaveDays: 0 });
  assert.deepEqual(payTermsAt(h, "2027-02"), { payType: "HOURLY", monthlySalary: 0, paidLeaveDays: 0 });
});

test("payTermsAt: cùng tháng → mốc tạo sau thắng", () => {
  const h = [
    { payType: "FULLTIME", monthlySalary: 8_000_000, effectiveMonth: "2026-11", createdAt: new Date(2) },
    { payType: "FULLTIME", monthlySalary: 7_000_000, effectiveMonth: "2026-11", createdAt: new Date(1) },
  ];
  assert.equal(payTermsAt(h, "2026-11").monthlySalary, 8_000_000);
});

test("computePay full-time: lương CB = lương cứng, giờ vẫn đếm", () => {
  const r = computePay({ hoursByWage: [{ hours: 8, wage: 0 }, { hours: 4.5, wage: 0 }], allowance: 100_000, totalBonus: 50_000, totalPenalty: 20_000, advance: 1_000_000, fixedBasePay: 8_000_000 });
  assert.equal(r.totalHours, 12.5);
  assert.equal(r.basePay, 8_000_000);
  assert.equal(r.netPay, 8_000_000 + 100_000 + 50_000 - 20_000 - 1_000_000);
  assert.equal(r.holidayExtra, 0);
});

test("unpaidLeaveAmount: lương / (ngày trong tháng − nghỉ có lương) × nghỉ không lương", () => {
  // 30 ngày, nghỉ có lương 4 → 26 ngày công chuẩn; nghỉ không lương 2 ngày
  assert.equal(unpaidLeaveAmount(7_800_000, 30, 4, 2), 600_000);
  assert.equal(unpaidLeaveAmount(8_000_000, 31, 4, 1.5), Math.round((8_000_000 / 27) * 1.5));
  assert.equal(unpaidLeaveAmount(8_000_000, 30, 4, 0), null);
  assert.equal(unpaidLeaveAmount(8_000_000, 30, 30, 1), null);
});

test("suggestUnpaidDays + daysOfMonth", () => {
  assert.equal(daysOfMonth("2026-02"), 28);
  assert.equal(daysOfMonth("2028-02"), 29);
  assert.equal(daysOfMonth("2026-11"), 30);
  assert.equal(suggestUnpaidDays(30, 24, 4), 2);
  assert.equal(suggestUnpaidDays(30, 28, 4), 0);
});

test("payTermsAt: giữ số ngày nghỉ có lương", () => {
  assert.equal(payTermsAt([{ payType: "FULLTIME", monthlySalary: 8_000_000, paidLeaveDays: 4, effectiveMonth: "2026-11" }], "2026-12").paidLeaveDays, 4);
});
