import { test } from "node:test";
import assert from "node:assert/strict";
import { roundedHours } from "../src/lib/calc";
import { autoApplied, baseHours, planRecalc, shortOf, type RecalcRow } from "../src/lib/hours-recalc";

const cfg = { stepHours: 0.5, graceMinutes: 3, graceHourMinutes: 4 };
const opts = { threshold: 1, maxShortMin: 23 };
let n = 0;
/** 1 lượt làm `min` phút, bắt đầu 08:00 ngày `day` tháng 10/2026 */
function row(min: number, day = 1, extra: Partial<RecalcRow> = {}): RecalcRow {
  const checkInAt = new Date(`2026-10-${String(day).padStart(2, "0")}T08:00:00+07:00`);
  const checkOutAt = new Date(checkInAt.getTime() + min * 60000);
  return {
    id: `a${++n}`,
    workDate: `2026-10-${String(day).padStart(2, "0")}`,
    checkInAt,
    checkOutAt,
    totalHours: Math.round((min / 60) * 100) / 100,
    base: roundedHours(checkInAt, checkOutAt, cfg),
    ...extra,
  };
}
const hm = (h: number, m: number) => h * 60 + m;

test("phút thiếu tới mốc kế tiếp", () => {
  const s = (min: number) => shortOf(new Date(0), new Date(min * 60000), cfg)!;
  assert.deepEqual([s(hm(4, 53)).rounded, s(hm(4, 53)).shortMin], [4.5, 7]); // 4,5 → thiếu 7' tới 5h
  assert.deepEqual([s(hm(4, 24)).rounded, s(hm(4, 24)).shortMin], [4, 6]);
  assert.deepEqual([s(hm(4, 7)).rounded, s(hm(4, 7)).shortMin], [4, 23]);
  // đã được làm tròn lên nhờ dung sai (4h28' → 4,5) → mốc kế tiếp còn > 30'
  assert.ok(s(hm(4, 28)).shortMin > 30);
});

test("Nga Le: chênh 3h → cộng 4 ca thiếu ít nhất, chênh còn 1h", () => {
  const rows = [
    row(hm(4, 55), 5), // thiếu 5'
    row(hm(4, 24), 12), // 6'
    row(hm(4, 53), 18), // 7'
    row(hm(4, 53), 21), // 7'
    row(hm(4, 42), 25), // 18'
    row(hm(4, 7), 9), // 23'
    // 11 ca 3h36' (thiếu 24' → không đủ điều kiện, mỗi ca chênh 6')
    ...Array.from({ length: 11 }, (_, i) => row(hm(3, 36), i + 1)),
  ];
  const p = planRecalc(rows, cfg, opts);
  assert.ok(Math.abs(p.gapBefore - 3) < 0.02, `gap ${p.gapBefore}`);
  assert.equal(p.needed, true);
  assert.equal(p.picks.length, 4);
  assert.deepEqual(p.picks.map((x) => x.shortMin), [5, 6, 7, 7]);
  assert.equal(p.added, 2);
  assert.equal(p.after, p.before + 2);
  assert.ok(p.gapAfter <= 1 && p.gapAfter > 0.5, `gapAfter ${p.gapAfter}`);
  assert.equal(p.enough, true);
  assert.equal(p.candidates.length, 6); // ca 18' và 23' đủ điều kiện nhưng không cần
});

test("Thu Hà: chênh 2h25 → cộng 1,5h (3 ca), chênh còn 0h55", () => {
  // 3 ca 4h55' (dư 25'/ca) + 1 ca 4h40' (dư 10') + 10 ca 3h36' (dư 6'/ca) = 145'
  const rows = [row(hm(4, 55), 1), row(hm(4, 55), 2), row(hm(4, 55), 3), row(hm(4, 40), 4), ...Array.from({ length: 10 }, (_, i) => row(hm(3, 36), i + 5))];
  const p = planRecalc(rows, cfg, opts);
  assert.ok(Math.abs(p.gapBefore - 145 / 60) < 0.01, `gap ${p.gapBefore}`);
  assert.equal(p.picks.length, 3);
  assert.equal(p.added, 1.5);
  assert.ok(p.gapAfter <= 1 && p.gapAfter > 0.5);
});

test("không đủ ca đủ điều kiện → cộng hết số ca có, báo chưa đủ", () => {
  const rows = [row(hm(4, 55), 1), row(hm(4, 54), 2), ...Array.from({ length: 25 }, (_, i) => row(hm(3, 36), i + 3))];
  const p = planRecalc(rows, cfg, opts);
  assert.ok(p.gapBefore > 2.5);
  assert.equal(p.picks.length, 2);
  assert.equal(p.added, 1);
  assert.equal(p.enough, false);
  assert.ok(p.gapAfter > 1);
});

test("chênh ≤ 1h hoặc giờ công ≥ thực tế → không tính", () => {
  const small = planRecalc([row(hm(4, 55), 1), row(hm(4, 55), 2), row(hm(4, 40), 3)], cfg, opts); // dư 25+25+10 = đúng 60' → chênh 1h00 (không > 1h)
  assert.equal(small.needed, false);
  assert.equal(small.picks.length, 0);
  const neg = planRecalc([row(hm(4, 28), 1), row(hm(3, 57), 2)], cfg, opts); // được làm tròn lên
  assert.ok(neg.gapBefore < 0);
  assert.equal(neg.needed, false);
  assert.equal(neg.after, neg.before);
});

test("bỏ qua ca thử việc, ca admin đã cộng tay, ca bị chỉnh giờ công", () => {
  const fillers = Array.from({ length: 20 }, (_, i) => row(hm(3, 36), i + 5));
  const trial = row(hm(4, 55), 1, { payFactor: 0.5 });
  trial.base = 2.25;
  const manual = row(hm(4, 55), 2, { extraHours: 0.5 });
  manual.base = 5;
  const edited = row(hm(4, 55), 3);
  edited.base = 3; // không khớp giờ vào–ra
  const ok = row(hm(4, 55), 4);
  const p = planRecalc([trial, manual, edited, ok, ...fillers], cfg, opts);
  assert.deepEqual(p.candidates.map((c) => c.id), [ok.id]);
});

test("cùng số phút thiếu: ca ngày thường trước ca ngày lễ", () => {
  const rows = [row(hm(4, 55), 2), row(hm(4, 55), 3), ...Array.from({ length: 14 }, (_, i) => row(hm(3, 36), i + 5))];
  const p = planRecalc(rows, cfg, { ...opts, holidays: new Set(["2026-10-02"]) });
  assert.equal(p.picks[0].workDate, "2026-10-03");
});

test("không làm tròn (bước 0) → không tính", () => {
  const p = planRecalc([row(hm(4, 55), 1)], { stepHours: 0, graceMinutes: 0 }, opts);
  assert.equal(p.needed, false);
});

test("phần tự cộng hợp lệ / đã bị tính lại", () => {
  assert.equal(autoApplied({ roundedHours: 5, autoPlus: 0.5, autoBase: 4.5 }), true);
  assert.equal(baseHours({ roundedHours: 5, autoPlus: 0.5, autoBase: 4.5 }), 4.5);
  // giờ công đã bị tính lại (sửa giờ) mà cờ còn sót → coi như chưa cộng
  assert.equal(autoApplied({ roundedHours: 6, autoPlus: 0.5, autoBase: 4.5 }), false);
  assert.equal(baseHours({ roundedHours: 6, autoPlus: 0.5, autoBase: 4.5 }), 6);
  assert.equal(baseHours({ roundedHours: 4, autoPlus: 0 }), 4);
});
