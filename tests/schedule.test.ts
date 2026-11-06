import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHistory, planAutoSchedule, slotInterval, type AutoOptions, type Entry, type TplInfo } from "../src/lib/schedule";
import { weekDays, weekStartOf } from "../src/lib/time";

const days = weekDays("2026-11-09");
const S: TplInfo = { id: "S", name: "S", startTime: "08:00", endTime: "13:00", minStaff: 2, targetStaff: 3 };
const C: TplInfo = { id: "C", name: "C", startTime: "12:00", endTime: "18:00", minStaff: 1, targetStaff: 2 };
const T: TplInfo = { id: "T", name: "T", startTime: "18:00", endTime: "23:00", minStaff: 0, targetStaff: 0 };
const staff = ["An", "Binh", "Chi", "Dung", "Em"].map((n) => ({ id: n, name: n }));
const base: AutoOptions = { approvePending: true, fillTo: "none", preferFrequentShift: false, preferCoworkers: false, maxShiftsPerWeek: 0, onlyRequested: false };
const noHist = { freq: {}, pair: {} };

test("tuần bắt đầu thứ 2", () => {
  assert.equal(weekStartOf("2026-11-15"), "2026-11-09"); // CN
  assert.equal(weekStartOf("2026-11-09"), "2026-11-09");
  assert.equal(days[6], "2026-11-15");
});

test("ca qua đêm & trùng giờ", () => {
  const [s, e] = slotInterval(days, days[0], { startTime: "22:00", endTime: "02:00" });
  assert.equal(e - s, 240);
});

test("duyệt đăng ký tới định mức, ưu tiên người ít ca", () => {
  const entries: Entry[] = [
    { id: "a1", userId: "An", tplId: "C", date: days[0], status: "APPROVED" },
    { id: "r1", userId: "An", tplId: "S", date: days[1], status: "PENDING", source: "REQUEST", createdAt: 1 },
    { id: "r2", userId: "Binh", tplId: "S", date: days[1], status: "PENDING", source: "REQUEST", createdAt: 2 },
    { id: "r3", userId: "Chi", tplId: "S", date: days[1], status: "PENDING", source: "REQUEST", createdAt: 3 },
    { id: "r4", userId: "Dung", tplId: "S", date: days[1], status: "PENDING", source: "REQUEST", createdAt: 4 },
  ];
  const r = planAutoSchedule({ days, templates: [S, C, T], staff, entries, history: noHist, opts: base });
  const ok = r.changes.filter((c) => c.kind === "approve").map((c) => c.userId).sort();
  // định mức 3: An đã có 1 ca → bị xếp sau, Binh/Chi/Dung được duyệt
  assert.deepEqual(ok, ["Binh", "Chi", "Dung"]);
});

test("không duyệt ca trùng giờ với ca đã có", () => {
  const entries: Entry[] = [
    { id: "a1", userId: "An", tplId: "S", date: days[0], status: "APPROVED" },
    { id: "r1", userId: "An", tplId: "C", date: days[0], status: "PENDING", source: "REQUEST" }, // 12–18 trùng 8–13
  ];
  const r = planAutoSchedule({ days, templates: [S, C], staff, entries, history: noHist, opts: base });
  assert.equal(r.changes.length, 0);
});

test("bù ca thiếu: chọn người ít ca nhất, hoà thì ưu tiên hay làm ca đó", () => {
  const entries: Entry[] = [
    { id: "a1", userId: "An", tplId: "C", date: days[0], status: "APPROVED" },
    { id: "a2", userId: "Binh", tplId: "C", date: days[1], status: "APPROVED" },
  ];
  const history = buildHistory([
    { userId: "Em", tplId: "S", date: "2026-11-02" },
    { userId: "Em", tplId: "S", date: "2026-11-03" },
  ]);
  const r = planAutoSchedule({
    days,
    templates: [{ ...S, minStaff: 1, targetStaff: 1 }],
    staff,
    entries,
    history,
    opts: { ...base, fillTo: "min", preferFrequentShift: true },
  });
  // 7 ngày × 1 người; ngày đầu: Chi/Dung/Em đều 0 ca → Em được ưu tiên vì hay làm ca S
  assert.equal(r.changes[0].kind, "add");
  assert.equal(r.changes[0].userId, "Em");
  assert.equal(r.slots.filter((s) => s.level === "short").length, 0);
  // phân bổ đều: không ai quá 2 ca
  assert.ok(Object.values(r.shiftCount).every((c) => c <= 2));
});

test("giới hạn số ca/tuần & cảnh báo thiếu người", () => {
  const r = planAutoSchedule({
    days,
    templates: [{ ...S, minStaff: 2, targetStaff: 2 }],
    staff: staff.slice(0, 2),
    entries: [],
    history: noHist,
    opts: { ...base, fillTo: "min", maxShiftsPerWeek: 3 },
  });
  assert.ok(Object.values(r.shiftCount).every((c) => c <= 3));
  assert.ok(r.slots.some((s) => s.level === "short"));
});
