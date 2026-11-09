import { test } from "node:test";
import assert from "node:assert/strict";
import { computePay, distanceMeters, earlyMinutes, faceDistance, formatDuration, lateMinutes, roundedHours, totalHours } from "../src/lib/calc";
import { addDays, localDate, localTime, zonedToDate } from "../src/lib/time";

const at = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 9, 1, h, m, s));
const R = { stepHours: 0.5, graceMinutes: 0 };

test("làm tròn xuống 0,5h (spec 4.3)", () => {
  assert.equal(roundedHours(at(0, 0), at(4, 45), R), 4.5); // 4h45' → 4,5
  assert.equal(roundedHours(at(0, 0), at(5, 10), R), 5); // 5h10' → 5
  assert.equal(roundedHours(at(0, 0), at(13, 41), R), 13.5); // 13h41' → 13,5
  assert.equal(roundedHours(at(0, 0), at(14, 55), R), 14.5); // làm tròn xuống tuyệt đối
  assert.equal(roundedHours(at(0, 0), at(4, 29, 59), R), 4);
  assert.equal(roundedHours(at(0, 0), at(4, 30), R), 4.5);
});

test("dung sai riêng mốc 0,5 (3 phút) và mốc 1 giờ (4 phút)", () => {
  const G = { stepHours: 0.5, graceMinutes: 3, graceHourMinutes: 4 };
  assert.equal(roundedHours(at(0, 0), at(3, 27), G), 3.5); // thiếu 3' tới 3h30 → 3,5
  assert.equal(roundedHours(at(0, 0), at(3, 26), G), 3); // thiếu 4' tới 3h30 → giữ 3
  assert.equal(roundedHours(at(0, 0), at(3, 56), G), 4); // thiếu 4' tới 4h00 → 4
  assert.equal(roundedHours(at(0, 0), at(3, 55), G), 3.5); // thiếu 5' tới 4h00 → 3,5
  assert.equal(roundedHours(at(0, 0), at(4, 0), G), 4);
  assert.equal(roundedHours(at(0, 0), at(4, 26), G), 4); // thiếu 4' tới 4h30 (dung sai 3') → 4
  assert.equal(roundedHours(at(0, 0), at(4, 29), G), 4.5); // thiếu 1' → 4,5
  // bước 1 giờ: mọi mốc là tròn giờ → dùng dung sai mốc 1 giờ
  assert.equal(roundedHours(at(0, 0), at(7, 56), { stepHours: 1, graceMinutes: 0, graceHourMinutes: 4 }), 8);
  // không đặt dung sai mốc 1 giờ → dùng chung dung sai mốc lẻ (như cũ)
  assert.equal(roundedHours(at(0, 0), at(14, 55), { stepHours: 0.5, graceMinutes: 5 }), 15);
});

test("dung sai làm tròn 5 phút (theo dữ liệu mẫu)", () => {
  const G = { stepHours: 0.5, graceMinutes: 5 };
  assert.equal(roundedHours(at(0, 0), at(14, 55), G), 15);
  assert.equal(roundedHours(at(0, 0), at(10, 56), G), 11);
  assert.equal(roundedHours(at(0, 0), at(6, 26), G), 6.5);
  assert.equal(roundedHours(at(0, 0), at(13, 41), G), 13.5);
});

test("dữ liệu mẫu 01/10/2026: 08:00:45 → 22:56:28", () => {
  const i = at(8, 0, 45);
  const o = at(22, 56, 28);
  assert.equal(totalHours(i, o), 14.93);
  assert.equal(formatDuration(i, o), "14:55");
});

test("đi muộn / về sớm theo ngưỡng", () => {
  assert.equal(lateMinutes(at(8, 4), at(8, 0), 5), 0);
  assert.equal(lateMinutes(at(8, 12), at(8, 0), 5), 12);
  assert.equal(earlyMinutes(at(16, 50), at(17, 0), 5), 10);
  assert.equal(earlyMinutes(at(17, 10), at(17, 0), 5), 0);
});

test("khoảng cách GPS", () => {
  const d = distanceMeters(21.0, 105.8, 21.001, 105.8);
  assert.ok(d > 100 && d < 120, String(d));
});

test("face distance", () => {
  assert.equal(faceDistance([0, 0], [3, 4]), 5);
  assert.equal(faceDistance([1], [1, 2]), Infinity);
});

test("tính lương: thực nhận = CB + PC + thưởng − phạt − tạm ứng", () => {
  const r = computePay({ hoursByWage: [{ hours: 100, wage: 25000 }, { hours: 20.5, wage: 30000 }], allowance: 200000, totalBonus: 100000, totalPenalty: 50000, advance: 500000 });
  assert.equal(r.totalHours, 120.5);
  assert.equal(r.basePay, 3115000);
  assert.equal(r.netPay, 3115000 + 200000 + 100000 - 50000 - 500000);
});

test("múi giờ VN", () => {
  const d = zonedToDate("2026-11-05", "00:00", "Asia/Ho_Chi_Minh");
  assert.equal(d.toISOString(), "2026-11-04T17:00:00.000Z");
  assert.equal(localDate(d, "Asia/Ho_Chi_Minh"), "2026-11-05");
  assert.equal(localTime(d, "Asia/Ho_Chi_Minh"), "00:00:00");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
});

test("làm liền nhiều ca: gộp khối, không cảnh báo về sớm sai", async () => {
  const { mergeShiftBlock, earlyMinutesInBlock } = await import("../src/lib/calc");
  const d = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 7, h, m));
  const S = { start: d(8), end: d(16), name: "S" };
  const C = { start: d(16), end: d(20), name: "C" };
  const T = { start: d(20), end: d(23), name: "T" };
  const b2 = mergeShiftBlock(S, [C]);
  assert.equal(b2.end.getTime(), d(20).getTime());
  assert.deepEqual(b2.segments.map((s) => s.name), ["S", "C"]);
  const b3 = mergeShiftBlock(S, [T, C]);
  assert.deepEqual(b3.segments.map((s) => s.name), ["S", "C", "T"]);
  assert.equal(b3.end.getTime(), d(23).getTime());
  // ca sau cách quá 30 phút → không gộp
  assert.deepEqual(mergeShiftBlock(S, [{ start: d(17), end: d(21), name: "X" }]).segments.map((s) => s.name), ["S"]);
  // nghỉ 20 phút giữa 2 ca → vẫn gộp
  assert.equal(mergeShiftBlock(S, [{ start: d(16, 20), end: d(20), name: "C" }]).segments.length, 2);
  // về sớm
  assert.equal(earlyMinutesInBlock(d(20), b2.segments, 5), 0); // ra cuối ca 2
  assert.equal(earlyMinutesInBlock(d(21), b2.segments, 5), 0); // ra muộn
  assert.equal(earlyMinutesInBlock(d(16), b2.segments, 5), 0); // ra đúng hết ca 1
  assert.equal(earlyMinutesInBlock(d(19, 30), b2.segments, 5), 30); // ra giữa ca 2
  assert.equal(earlyMinutesInBlock(d(15, 30), b2.segments, 5), 30); // ra giữa ca 1
  assert.equal(earlyMinutesInBlock(d(19, 57), b2.segments, 5), 0); // trong ngưỡng
});

test("ngày lễ: giờ làm × hệ số (mặc định ×1), tách riêng phần phụ trội", async () => {
  const r = computePay({
    hoursByWage: [
      { hours: 100, wage: 25000 },
      { hours: 8, wage: 25000, mult: 2 }, // Quốc khánh ×2
      { hours: 4, wage: 30000, mult: 3 }, // Tết ×3
    ],
    allowance: 0,
    totalBonus: 0,
    totalPenalty: 0,
    advance: 0,
  });
  assert.equal(r.totalHours, 112); // giờ công thật, không nhân
  assert.equal(r.basePay, 100 * 25000 + 8 * 25000 * 2 + 4 * 30000 * 3);
  assert.equal(r.holidayHours, 12);
  assert.equal(r.holidayExtra, 8 * 25000 + 4 * 30000 * 2);
  const { holidayNote } = await import("../src/lib/holiday");
  const hol = new Map([["2026-09-02", { name: "Quốc khánh", multiplier: 2 }]]);
  assert.equal(
    holidayNote([{ workDate: "2026-09-02", roundedHours: 4 }, { workDate: "2026-09-02", roundedHours: 4.5 }, { workDate: "2026-09-03", roundedHours: 8 }], hol),
    "Quốc khánh 02/09 8.5h ×2",
  );
});
