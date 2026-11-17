import { test } from "node:test";
import assert from "node:assert/strict";
import { appPayout, monthCashbook } from "../src/lib/cashbook";

const data = {
  revenue: [
    { date: "2026-10-05", tk: 1000, tm: 500 },
    { date: "2026-11-02", tk: 300, tm: 200 },
    { date: "2026-12-01", tk: 9999, tm: 9999 },
  ],
  bills: [{ date: "2026-10-10", amount: 100 }, { date: "2026-11-03", amount: 50 }],
  moves: [
    { date: "2026-10-20", kind: "TAKE", account: "TK", amount: 200 },
    { date: "2026-11-05", kind: "TAKE", account: "TM", amount: 100 },
    { date: "2026-11-06", kind: "ADD", account: "TK", amount: 40 },
  ],
  payroll: [{ date: "2026-11-01", amount: 70 }],
};

test("tồn tháng trước chuyển sang tháng sau", () => {
  const nov = monthCashbook({ month: "2026-11", ...data });
  assert.deepEqual(nov.opening, { tk: 700, tm: 500 });
  assert.equal(nov.tk.revenue, 300);
  assert.equal(nov.tk.balance, 700 + 300 - 50 - 70 + 40);
  assert.equal(nov.tm.balance, 500 + 200 - 100);
});

test("xem tháng cũ = số dư cuối tháng đó, không tính phiếu sau", () => {
  const oct = monthCashbook({ month: "2026-10", ...data });
  assert.deepEqual(oct.opening, { tk: 0, tm: 0 });
  assert.equal(oct.tk.balance, 700);
});

test("sửa phiếu tháng trước → số tồn tháng sau đổi theo", () => {
  const moves = data.moves.map((m) => (m.date === "2026-10-20" ? { ...m, amount: 300 } : m));
  assert.equal(monthCashbook({ month: "2026-11", ...data, moves }).opening.tk, 600);
});

test("Grab / Shopee: trừ phí sàn rồi cộng vào tài khoản (chưa cài % → 30%)", () => {
  assert.equal(appPayout(100_000, 200_000), 70_000 + 140_000);
  assert.equal(appPayout(100_000, 0, { grab: 25 }), 75_000);
  const r = monthCashbook({ month: "2026-11", revenue: [{ date: "2026-11-02", tk: 1000, tm: 0, app: appPayout(1000, 0) }], bills: [], moves: [] });
  assert.equal(r.tk.app, 700);
  assert.equal(r.tk.balance, 1700);
  assert.equal(r.tm.balance, 0);
});
