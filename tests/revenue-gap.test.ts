import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGapNote } from "../src/lib/revenue-gap";
import { parseTable } from "../src/lib/revenue-import";

const SHIFTS = ["Sáng", "Chiều", "Tối"];

test("ghi chú nhắc ca khác âm / dư", () => {
  assert.deepEqual(
    parseGapNote("ca sáng âm 10k do thối nhầm", SHIFTS).mentions.map((m) => [m.shiftName, m.amount]),
    [["Sáng", -10000]],
  );
  assert.deepEqual(
    parseGapNote("Ca Chieu du 10.000", SHIFTS).mentions.map((m) => [m.shiftName, m.amount]),
    [["Chiều", 10000]],
  );
  assert.deepEqual(
    parseGapNote("ca sang -15k, ca chiều thừa +5k", SHIFTS).mentions.map((m) => [m.shiftName, m.amount]),
    [["Sáng", -15000], ["Chiều", 5000]],
  );
  // chỉ có số, không rõ âm / dư → không đoán
  assert.equal(parseGapNote("ca sáng 10k", SHIFTS).mentions.length, 0);
});

test("ghi chú đơn chưa thanh toán", () => {
  assert.equal(parseGapNote("1 đơn chưa TT 120k bàn 5", SHIFTS).unpaid, true);
  assert.equal(parseGapNote("khach no 50k", SHIFTS).unpaid, true);
  assert.equal(parseGapNote("ck sau", SHIFTS).unpaid, true);
  assert.equal(parseGapNote("mua đá 30k", SHIFTS).unpaid, false);
});

test("đọc bảng Báo cáo bán hàng theo thời gian (KiotViet)", () => {
  const r = parseTable([
    ["Ngày lập 16/11/2026 13:13"],
    ["Báo cáo bán hàng theo thời gian"],
    ["Từ ngày 01/11/2026 đến ngày 30/11/2026"],
    ["Chi nhánh: Văn Phú"],
    ["Thời gian", "Doanh thu", "Giá trị trả", "Doanh thu thuần"],
    ["", "109.850.000", "-0", "109.850.000"],
    ["16/11/2026", "480.000", "-0", "480.000"],
    ["15/11/2026", "10.490.000", "-0", "10.490.000"],
    ["01/11/2026", "12.245.000", "-0", "12.245.000"],
  ]);
  assert.equal(r.branch, "Văn Phú");
  assert.equal(r.from, "2026-11-01");
  assert.equal(r.to, "2026-11-30");
  assert.equal(r.total, 109850000);
  assert.deepEqual(r.rows, [
    { date: "2026-11-01", dt: 12245000 },
    { date: "2026-11-15", dt: 10490000 },
    { date: "2026-11-16", dt: 480000 },
  ]);
});
