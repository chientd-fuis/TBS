import { test } from "node:test";
import assert from "node:assert/strict";
import { cellMoney, looksThousands, parseMonthGrid, tabMonth } from "../src/lib/sheet-import";

test("tên tab → tháng", () => {
  const cur = "2026-11";
  assert.equal(tabMonth("T10-26", cur), "2026-10");
  assert.equal(tabMonth("T10/2026", cur), "2026-10");
  assert.equal(tabMonth("T 9.26", cur), "2026-09");
  assert.equal(tabMonth("Tháng 10 - 2025", cur), "2025-10");
  assert.equal(tabMonth("T10", cur), "2026-10"); // không năm → tháng 10 gần nhất đã qua
  assert.equal(tabMonth("T11", cur), "2025-11"); // tháng này chưa qua → năm trước
  assert.equal(tabMonth("T12", cur), "2025-12");
  assert.equal(tabMonth("t03", cur), "2026-03");
  assert.equal(tabMonth("Tổng hợp", cur), null);
  assert.equal(tabMonth("10", cur), null);
  assert.equal(tabMonth("T13", cur), null);
});

test("ô → số tiền", () => {
  assert.equal(cellMoney(1234000), 1234000);
  assert.equal(cellMoney("1.234.000"), 1234000);
  assert.equal(cellMoney("1,234,000 đ"), 1234000);
  assert.equal(cellMoney(""), null);
  assert.equal(cellMoney("-"), null);
  assert.equal(cellMoney("-50.000"), -50000);
  assert.equal(cellMoney(undefined), null);
});

test("lưới ô → doanh thu từng ngày (mẫu có cột Grab, ngày 1 ở dòng 3)", () => {
  const grid: unknown[][] = [["Ngày", "DT"], ["", "DT máy", "TK", "TM", "Thu chi", "Shopee", "Grab"]];
  grid[2] = [1, 5_000_000, 3_000_000, 1_800_000, 100_000, 50_000, 50_000, "", "", "ghi chú 1"];
  grid[3] = [2, "", "", ""]; // ngày trống → bỏ
  grid[4] = [3, "4.000.000", "2.500.000", "1.500.000"];
  const days = parseMonthGrid(grid, { layout: "GRAB_COL", firstRow: 3, month: "2026-10" });
  assert.equal(days.length, 2);
  assert.deepEqual(days[0], { date: "2026-10-01", revenue: { dt: 5_000_000, tk: 3_000_000, tm: 1_800_000, cp: 100_000, shopee: 50_000, grab: 50_000 }, note: "ghi chú 1", row: 3 });
  assert.equal(days[1].date, "2026-10-03");
  assert.equal(days[1].revenue.tm, 1_500_000);
});

test("mẫu cũ: cột F = Shopee + Grab gộp; nhân 1.000", () => {
  const grid: unknown[][] = [[], [], [1, 5000, 3000, 1800, 100, 200]];
  const days = parseMonthGrid(grid, { layout: "LEGACY", firstRow: 3, month: "2026-09", scale: 1000 });
  assert.deepEqual(days[0].revenue, { dt: 5_000_000, tk: 3_000_000, tm: 1_800_000, cp: 100_000, shopee: 200_000, grab: 0 });
  assert.equal(looksThousands(parseMonthGrid(grid, { layout: "LEGACY", firstRow: 3, month: "2026-09" })), true);
  assert.equal(looksThousands(days), false);
});
