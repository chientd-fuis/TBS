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
