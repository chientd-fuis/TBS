import { test } from "node:test";
import assert from "node:assert/strict";
import { cashBalance, cashKindOf } from "../src/lib/cashbook";

test("sổ quỹ: TK = DT TK − bill CK − rút lãi + vốn ± chuyển; TM = DT TM − rút + vốn ± chuyển", () => {
  const f = cashBalance({
    revenue: [
      { tk: 3_000_000, tm: 1_000_000 },
      { tk: 2_000_000, tm: 500_000 },
    ],
    bills: [{ amount: 700_000 }, { amount: 300_000 }],
    moves: [
      { kind: "TAKE", account: "TK", amount: 1_000_000 },
      { kind: "TAKE", account: "TM", amount: 200_000 },
      { kind: "ADD", account: "TK", amount: 500_000 },
      { kind: "ADD", account: "TM", amount: 100_000 },
      { kind: "DEPOSIT", amount: 400_000 }, // TM → TK
      { kind: "WITHDRAW", amount: 50_000 }, // TK → TM
    ],
  });
  assert.equal(f.tk.balance, 5_000_000 - 1_000_000 - 1_000_000 + 500_000 + 400_000 - 50_000);
  assert.equal(f.tm.balance, 1_500_000 - 200_000 + 100_000 - 400_000 + 50_000);
  // chuyển qua lại không đổi tổng tiền
  assert.equal(f.tk.balance + f.tm.balance, 6_500_000 - 1_000_000 - 1_200_000 + 600_000);
});

test("sổ quỹ: phiếu cũ (chỉ DEPOSIT / WITHDRAW) vẫn đọc được; TAKE thiếu account coi là TK", () => {
  assert.equal(cashKindOf({ kind: "DEPOSIT" })?.short, "TM → TK");
  assert.equal(cashKindOf({ kind: "TAKE" })?.value, "TAKE_TK");
  assert.equal(cashKindOf({ kind: "ADD", account: "TM" })?.value, "ADD_TM");
  const f = cashBalance({ revenue: [], bills: [], moves: [{ kind: "TAKE", amount: 10 }] });
  assert.equal(f.tk.balance, -10);
  assert.equal(f.tm.balance, 0);
});

test("sổ quỹ: lương đã trả → phiếu 'Thanh toán lương tháng xx', trả lẻ NV nghỉ việc ghi riêng, trừ tài khoản", async () => {
  const { payrollEntries } = await import("../src/lib/cashbook");
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const pays = payrollEntries(
    [
      { id: "p10", month: "2026-10", store: "Văn Phú", status: "PAID", paidAt: new Date("2026-11-05T03:00:00Z") },
      { id: "p11", month: "2026-11", store: "Văn Phú", status: "DRAFT", paidAt: null },
    ],
    [
      { payrollId: "p10", netPay: 5_000_000, paidAt: new Date("2026-11-05T03:00:00Z"), name: "An", quit: false },
      { payrollId: "p10", netPay: 4_000_000, paidAt: new Date("2026-11-05T03:00:00Z"), name: "Bình", quit: false },
      { payrollId: "p11", netPay: 1_200_000, paidAt: new Date("2026-11-10T03:00:00Z"), name: "Lan", quit: true },
      { payrollId: "p11", netPay: 2_000_000, paidAt: null, name: "Mai", quit: false },
    ],
    day,
  );
  assert.deepEqual(pays, [
    { date: "2026-11-10", amount: 1_200_000, note: "Thanh toán lương tháng 11/2026 cho nhân viên nghỉ việc Lan · Văn Phú" },
    { date: "2026-11-05", amount: 9_000_000, note: "Thanh toán lương tháng 10/2026 · Văn Phú" },
  ]);
  const f = cashBalance({ revenue: [{ tk: 20_000_000, tm: 0 }], bills: [], moves: [], payroll: pays });
  assert.equal(f.tk.payroll, 10_200_000);
  assert.equal(f.tk.balance, 9_800_000);
});

test("đếm tiền: tiền mặt ngày = chốt ca ± phiếu nộp / rút đúng cơ sở + ngày", async () => {
  const { applyDayTransfers } = await import("../src/lib/cashbook");
  const rows = applyDayTransfers(
    [
      { storeId: "a", date: "2026-11-10", tm: 3_000_000, tk: 1_000_000 },
      { storeId: "b", date: "2026-11-10", tm: 2_000_000, tk: 0 },
    ],
    [
      { kind: "DEPOSIT", amount: 1_000_000, storeId: "a", date: "2026-11-10" },
      { kind: "WITHDRAW", amount: 200_000, storeId: "a", date: "2026-11-10" },
      { kind: "TAKE", amount: 999, storeId: "b", date: "2026-11-10" },
      { kind: "DEPOSIT", amount: 500_000, date: "2026-11-10" },
    ],
  );
  assert.deepEqual(rows.map((r) => [r.tm, r.tk]), [[2_200_000, 1_800_000], [2_000_000, 0]]);
});
