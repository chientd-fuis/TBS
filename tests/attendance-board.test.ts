import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMonthBoard, type BoardAtt } from "../src/lib/attendance-board";

const tz = "Asia/Ho_Chi_Minh";
const at = (d: number, h: number, m = 0) => new Date(Date.UTC(2026, 10, d, h - 7, m));
const days = ["2026-11-02", "2026-11-03", "2026-11-04"];
const templates = [
  { id: "S", name: "S", startTime: "08:00", endTime: "13:00" },
  { id: "C", name: "C", startTime: "13:00", endTime: "18:00" },
];
const base = { storeId: "A", tz, days, templates, names: { u1: "An", u2: "Bình", u3: "Chi" }, homeOf: { u1: "A", u2: "A", u3: "B" }, storeTag: { A: "CS1", B: "CS2" }, now: at(4, 10) };
const att = (p: Partial<BoardAtt> & { id: string; userId: string; workDate: string; checkInAt: Date }): BoardAtt => ({ storeId: "A", homeStoreId: "A", status: "COMPLETED", ...p });

test("bảng chấm công theo ca: đã làm / bỏ ca / muộn-sớm / làm thêm / hỗ trợ", () => {
  const { cells } = buildMonthBoard({
    ...base,
    assignments: [
      { id: "a1", userId: "u1", tplId: "S", date: "2026-11-02", startTime: "08:00", endTime: "13:00" },
      { id: "a2", userId: "u1", tplId: "C", date: "2026-11-02", startTime: "13:00", endTime: "18:00" },
      { id: "a3", userId: "u2", tplId: "S", date: "2026-11-02", startTime: "08:00", endTime: "13:00" }, // bỏ ca
      { id: "a4", userId: "u2", tplId: "C", date: "2026-11-04", startTime: "13:00", endTime: "18:00" }, // chưa tới
    ],
    attendances: [
      // u1 làm liền S+C, vào muộn 10', ra sớm 20'
      att({ id: "t1", userId: "u1", workDate: "2026-11-02", checkInAt: at(2, 8, 10), checkOutAt: at(2, 17, 40), lateMinutes: 10, earlyMinutes: 20 }),
      // u1 làm thêm ca không có lịch
      att({ id: "t2", userId: "u1", workDate: "2026-11-03", checkInAt: at(3, 13), checkOutAt: at(3, 18), outOfShift: true }),
      // u2 (cơ sở A) đi hỗ trợ cơ sở B
      att({ id: "t3", userId: "u2", storeId: "B", workDate: "2026-11-03", checkInAt: at(3, 8), checkOutAt: at(3, 13) }),
      // u3 (cơ sở B) sang hỗ trợ cơ sở A
      att({ id: "t4", userId: "u3", homeStoreId: "B", workDate: "2026-11-04", checkInAt: at(4, 8), status: "OPEN" }),
    ],
  });
  const S2 = cells["2026-11-02|S"];
  assert.deepEqual(S2.map((c) => [c.name, c.state, c.late ?? 0, c.early ?? 0]), [["An", "worked", 10, 0], ["Bình", "missed", 0, 0]]);
  assert.deepEqual(cells["2026-11-02|C"].map((c) => [c.name, c.state, c.late ?? 0, c.early ?? 0]), [["An", "worked", 0, 20]]);
  const C3 = cells["2026-11-03|C"][0];
  assert.equal(C3.extra, true);
  const S3 = cells["2026-11-03|S"][0];
  assert.deepEqual([S3.name, S3.tag?.label, S3.tag?.kind, S3.extra], ["Bình", "CS2", "away", undefined]);
  assert.equal(cells["2026-11-04|C"][0].state, "upcoming");
  const S4 = cells["2026-11-04|S"][0];
  assert.deepEqual([S4.name, S4.tag?.label, S4.tag?.kind, S4.linkStoreId], ["Chi", "CS2", "from", "B"]);
});

test("bảng chấm công theo ca: đang trong ca nhấp nháy – xuyên ca / đã ra ca sáng rồi vào lại ca chiều", () => {
  const now = at(4, 15);
  const { cells } = buildMonthBoard({
    ...base,
    now,
    assignments: [
      { id: "a1", userId: "u1", tplId: "S", date: "2026-11-04", startTime: "08:00", endTime: "13:00" },
      { id: "a2", userId: "u2", tplId: "S", date: "2026-11-04", startTime: "08:00", endTime: "13:00" },
      { id: "a3", userId: "u2", tplId: "C", date: "2026-11-04", startTime: "13:00", endTime: "18:00" },
    ],
    attendances: [
      // u1 vào ca sáng, giờ là ca chiều vẫn chưa check-out (không có lịch ca chiều) → xuyên ca
      att({ id: "t1", userId: "u1", workDate: "2026-11-04", checkInAt: at(4, 8), status: "OPEN" }),
      // u2 ra ca sáng rồi vào lại ca chiều
      att({ id: "t2", userId: "u2", workDate: "2026-11-04", checkInAt: at(4, 8), checkOutAt: at(4, 12, 55) }),
      att({ id: "t3", userId: "u2", workDate: "2026-11-04", checkInAt: at(4, 13), status: "OPEN" }),
    ],
  });
  const pick = (k: string, u: string) => cells[k].find((c) => c.userId === u);
  assert.equal(pick("2026-11-04|S", "u1")?.live, true);
  assert.equal(pick("2026-11-04|C", "u1")?.live, true);
  assert.equal(cells["2026-11-04|C"].filter((c) => c.userId === "u1").length, 1);
  assert.equal(pick("2026-11-04|S", "u2")?.live, undefined);
  assert.equal(pick("2026-11-04|S", "u2")?.state, "worked");
  assert.equal(pick("2026-11-04|C", "u2")?.live, true);
});
