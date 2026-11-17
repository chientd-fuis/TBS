import { test } from "node:test";
import assert from "node:assert/strict";
import { computePnl, monthDayShare } from "../src/lib/finance";

test("tiền thuê chia ngày: cộng đủ tháng đúng bằng số tiền thuê", () => {
  for (const [amt, m] of [[12_000_000, "2026-10"], [15_000_000, "2026-11"], [7_777_777, "2026-02"]] as const) {
    const n = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5), 0)).getUTCDate();
    let s = 0;
    for (let d = 1; d <= n; d++) s += monthDayShare(amt, m, d);
    assert.equal(s, amt);
  }
});

test("bill / thuê nhà của cơ sở không có trong báo cáo → không dồn sang chi phí chung", () => {
  const r = computePnl({
    storeIds: ["A"],
    dates: ["2026-11-01"],
    revenue: [],
    expenses: [{ date: "2026-11-01", amount: 500, scope: "STORE", storeId: "B", category: "KHAC" }],
    fixed: [{ amountPerMonth: 3_000_000, scope: "STORE", storeId: "B", startMonth: "2026-01" }],
    labor: [],
    fees: {},
  });
  assert.equal(r.total.shared, 0);
  assert.equal(r.total.cost, 0);
  assert.equal(r.costGroups.MAT_BANG, 0);
  assert.equal(r.costGroups.KHAC, 0);
});
