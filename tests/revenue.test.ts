import { test } from "node:test";
import assert from "node:assert/strict";
import { evalMoneyExpr, extractSheetId, normalizeOcr, parseMoney, revenueDiff, sheetRowOf, sheetTabName, sumRevenue } from "../src/lib/revenue";

test("parseMoney", () => {
  assert.equal(parseMoney("7.060.000 đ"), 7060000);
  assert.equal(parseMoney("7,060,000"), 7060000);
  assert.equal(parseMoney("72.000đ"), 72000);
  assert.equal(parseMoney("850k"), 850000);
  assert.equal(parseMoney("7tr06"), 7060000);
  assert.equal(parseMoney("7.5tr"), 7500000);
  assert.equal(parseMoney(1328000), 1328000);
  assert.equal(parseMoney("0 đ"), 0);
  assert.equal(parseMoney("abc"), null);
  assert.equal(parseMoney(""), null);
});

test("evalMoneyExpr: biểu thức nhân viên gõ", () => {
  assert.equal(evalMoneyExpr("10000 +20000 + 20k").value, 50000);
  assert.equal(evalMoneyExpr("30k sữa chua + 20k ship").value, 50000);
  assert.equal(evalMoneyExpr("1tr2 - 50k").value, 1150000);
  assert.equal(evalMoneyExpr("2 ly trà 30k + ship 15k").value, 45000);
  assert.equal(evalMoneyExpr("5.660.000").value, 5660000);
  assert.equal(evalMoneyExpr("50,000").value, 50000);
  assert.equal(evalMoneyExpr("20 nghìn + 5k").value, 25000);
  assert.deepEqual(evalMoneyExpr(""), { value: 0, ok: true, items: 0 });
  const bad = evalMoneyExpr("30k + sữa chua");
  assert.equal(bad.value, 30000);
  assert.equal(bad.ok, false);
});

test("normalizeOcr: tên trường tiếng Việt, bọc trong data", () => {
  const r = normalizeOcr({ data: { "Doanh thu": "7.060.000", "Tài khoản": "5.660.000 đ", "Tiền mặt": 1328000, "Thu chi": "72k", Grab: "0", Shopee: "0", "Ghi chú": " ok " } });
  assert.deepEqual(r.values, { dt: 7060000, tk: 5660000, tm: 1328000, cp: 72000, grab: 0, shopee: 0 });
  assert.equal(r.note, "ok");
  assert.deepEqual(normalizeOcr(null).values, {});
});

test("cộng doanh thu ngày + âm/dương", () => {
  const day = sumRevenue([{ dt: 3000, tk: 2000, tm: 900, cp: 100, shopee: 0 }, { dt: 4060, tk: 3660, tm: 428, grab: 50 }]);
  assert.deepEqual(day, { dt: 7060, tm: 1328, tk: 5660, cp: 100, grab: 50, shopee: 0 });
  assert.equal(revenueDiff(day), -78);
  assert.equal(revenueDiff({ dt: 100, tm: 100 }), 0);
});

test("vị trí trên Google Sheet", () => {
  assert.equal(sheetTabName("T{m}", "2026-11"), "T11");
  assert.equal(sheetTabName("T{m}", "2026-09"), "T9");
  assert.equal(sheetTabName("{mm}/{yyyy}", "2026-09"), "09/2026");
  assert.equal(sheetRowOf("2026-11-01"), 3);
  assert.equal(sheetRowOf("2026-11-31", 3), 33);
  assert.equal(extractSheetId("https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0"), "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
  assert.equal(extractSheetId("not a link"), "");
});

test("ca chốt mặc định theo giờ + ngày doanh thu", async () => {
  const { defaultClosingShift, closingWorkDate } = await import("../src/lib/revenue");
  const { addDays } = await import("../src/lib/time");
  assert.equal(defaultClosingShift(8), "S");
  assert.equal(defaultClosingShift(15), "S");
  assert.equal(defaultClosingShift(16), "C");
  assert.equal(defaultClosingShift(19), "C");
  assert.equal(defaultClosingShift(20), "T");
  assert.equal(defaultClosingShift(1), "T");
  assert.equal(closingWorkDate("T", "2026-11-07", 1, addDays), "2026-11-06");
  assert.equal(closingWorkDate("T", "2026-11-07", 22, addDays), "2026-11-07");
  assert.equal(closingWorkDate("S", "2026-11-07", 9, addDays), "2026-11-07");
});

test("mẫu cột Google Sheet theo cơ sở", async () => {
  const { sheetLayoutOf, sheetRowCells } = await import("../src/lib/revenue");
  assert.equal(sheetLayoutOf({ name: "TBS Geleximco" }), "GRAB_COL");
  assert.equal(sheetLayoutOf({ name: "TBS Văn Phú" }), "LEGACY");
  assert.equal(sheetLayoutOf({ name: "TBS Văn Phú", revenueSheetLayout: "GRAB_COL" }), "GRAB_COL");
  const r = { dt: 1000, tk: 500, tm: 300, cp: 50, shopee: 100, grab: 50 };
  assert.deepEqual(sheetRowCells("GRAB_COL", 9, r, "ok"), [
    { range: "B9:G9", values: [[1000, 500, 300, 50, 100, 50]] },
    { range: "J9", values: [["ok"]] },
  ]);
  assert.deepEqual(sheetRowCells("LEGACY", 9, r, "ok"), [
    { range: "B9:F9", values: [[1000, 500, 300, 50, 150]] },
    { range: "I9", values: [["Shopee 100 + Grab 50 | ok"]] },
  ]);
});
