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

test("đọc ảnh: ngày + chi tiết thu chi + phản hồi Gemini", async () => {
  const { parseOcrDate, normalizeOcr } = await import("../src/lib/revenue");
  const { parseGeminiResponse } = await import("../src/lib/ocr");
  assert.equal(parseOcrDate("07/11/2026"), "2026-11-07");
  assert.equal(parseOcrDate("7/11", "2026-11-08"), "2026-11-07");
  assert.equal(parseOcrDate("07-11-26"), "2026-11-07");
  assert.equal(parseOcrDate("2026-11-07"), "2026-11-07");
  assert.equal(parseOcrDate("32/13"), null);
  const body = { candidates: [{ content: { parts: [{ text: '{"dt":1760000,"tm":260000,"tk":null,"cp":50000,"cp_detail":"30k sữa chua + 20k ship","grab":null,"shopee":0,"date":"2026-11-07","note":null}' }] } }] };
  const r = normalizeOcr(parseGeminiResponse(body), "2026-11-07");
  assert.deepEqual(r.values, { dt: 1760000, tm: 260000, cp: 50000, shopee: 0 });
  assert.equal(r.cpDetail, "30k sữa chua + 20k ship");
  assert.equal(r.date, "2026-11-07");
  assert.throws(() => parseGeminiResponse({ candidates: [] }), /không trả về/);
});

test("tách khoản thu chi trong ca", async () => {
  const { moneyExprItems } = await import("../src/lib/revenue");
  assert.deepEqual(moneyExprItems("30k sữa chua + 20k ship"), [{ amount: 30000, label: "sữa chua" }, { amount: 20000, label: "ship" }]);
  assert.deepEqual(moneyExprItems("đá 15k - 5k trả lại"), [{ amount: 15000, label: "đá" }, { amount: -5000, label: "trả lại" }]);
  assert.deepEqual(moneyExprItems("50000"), [{ amount: 50000, label: "" }]);
  assert.deepEqual(moneyExprItems(""), []);
});

test("diễn giải lỗi Gemini hết lượt / quá tải", async () => {
  const { describeGeminiError } = await import("../src/lib/ocr");
  const perDay = { error: { code: 429, message: "You exceeded your current quota", details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "35s" }] } };
  assert.deepEqual(describeGeminiError(429, perDay, "gemini-2.5-flash"), { text: "gemini-2.5-flash: hết lượt miễn phí trong ngày (20 lượt/ngày)", retryable: true });
  const perMin = { error: { details: [{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { retryDelay: "12s" }] } };
  assert.match(describeGeminiError(429, perMin, "m").text, /1 phút, thử lại sau 12s/);
  assert.match(describeGeminiError(503, {}, "m").text, /quá tải/);
  assert.equal(describeGeminiError(400, { error: { message: "API key not valid" } }, "m").retryable, false);
});

test("lỗi vị trí không hỗ trợ Gemini", async () => {
  const { describeGeminiError } = await import("../src/lib/ocr");
  const r = describeGeminiError(400, { error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" } }, "m");
  assert.equal(r.retryable, false);
  assert.match(r.text, /sin1/);
});

test("tờ chốt ca viết tay: đơn vị nghìn, tổng NV ghi, DTm", async () => {
  const { normalizeOcr, closingSum } = await import("../src/lib/revenue");
  const r = normalizeOcr({ dt: null, tm: 2487, tk: 6850, cp: 50, cp_detail: "30 sữa chua + 20 ship", staff_total: 9387, date: "2026-11-07" }, "2026-11-08");
  assert.deepEqual(r.values, { tm: 2_487_000, tk: 6_850_000, cp: 50_000 });
  assert.equal(r.cpDetail, "30k sữa chua + 20k ship");
  assert.equal(r.staffTotal, 9_387_000);
  assert.equal(r.scaled, true);
  assert.equal(closingSum(r.values), 9_387_000);
  // phiếu đủ đồng → giữ nguyên; "total" không còn bị hiểu là DT máy
  const p = normalizeOcr({ dtm: 5_200_000, tm: 1_200_000, total: 5_150_000 });
  assert.deepEqual(p.values, { dt: 5_200_000, tm: 1_200_000 });
  assert.equal(p.staffTotal, 5_150_000);
  assert.equal(p.scaled, undefined);
});

test("ngày trên tờ chốt ca chỉ ghi ngày/tháng", async () => {
  const { normalizeOcr } = await import("../src/lib/revenue");
  assert.equal(normalizeOcr({ tm: 2_000_000, date: "8/11" }, "2026-11-08").date, "2026-11-08");
  assert.equal(normalizeOcr({ tm: 2_000_000, date: "08/11" }, "2026-11-08").date, "2026-11-08");
  assert.equal(normalizeOcr({ tm: 2_000_000, date: "Ca tối 7/11" }, "2026-11-08").date, "2026-11-07");
  assert.equal(normalizeOcr({ tm: 2_000_000, date: null }, "2026-11-08").date, undefined);
});

test("chốt ca luỹ kế: doanh thu ngày = ca Tối, riêng ca = chênh lệch", async () => {
  const { dayClosing, shiftDeltas } = await import("../src/lib/revenue");
  const list = [
    { shiftName: "Tối", createdAt: "2026-11-08T15:41:00Z", revenue: { tm: 2_300_000, tk: 4_100_000, cp: 120_000 } },
    { shiftName: "Sáng", createdAt: "2026-11-08T09:05:00Z", revenue: { tm: 800_000, tk: 1_200_000, cp: 50_000 } },
    { shiftName: "Chiều", createdAt: "2026-11-08T13:02:00Z", revenue: { tm: 1_500_000, tk: 2_500_000, cp: 80_000 } },
  ];
  assert.equal(dayClosing(list)!.shiftName, "Tối");
  const d = shiftDeltas(list);
  assert.deepEqual(d.map((x) => x.closing.shiftName), ["Sáng", "Chiều", "Tối"]);
  assert.equal(d[1].own.tk, 1_300_000);
  assert.equal(d[2].own.tm, 800_000);
  assert.equal(d[2].own.cp, 40_000);
  assert.equal(dayClosing(list.slice(1))!.shiftName, "Chiều"); // chưa chốt Tối → ca gần nhất
});
