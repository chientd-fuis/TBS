import { test } from "node:test";
import assert from "node:assert/strict";
import { forecastStaff, type ShiftRev } from "../src/lib/forecast";

test("dự báo: doanh thu cùng thứ / doanh thu mỗi người → số người; ngày lễ nhân hệ số", () => {
  const history: ShiftRev[] = [];
  // 6 tuần: ca Tối thứ 7 ~ 4tr với 2 người (2tr/người), thứ 2 ~ 2tr với 2 người (1tr/người)
  for (let w = 0; w < 6; w++) {
    const sat = new Date(Date.UTC(2026, 9, 3 + w * 7)).toISOString().slice(0, 10); // T7
    const mon = new Date(Date.UTC(2026, 9, 5 + w * 7)).toISOString().slice(0, 10); // T2
    history.push({ date: sat, tplId: "T", rev: 6_000_000, staff: 3 }, { date: mon, tplId: "T", rev: 2_000_000, staff: 2 });
  }
  const r = forecastStaff({
    history,
    templates: [{ id: "T", name: "Tối", startTime: "18:00", targetStaff: 2, minStaff: 1 }],
    days: ["2026-11-21", "2026-11-23", "2026-11-20"], // T7, T2, T6 (ngày lễ, không có lịch sử thứ 6)
    holidays: new Set(["2026-11-20"]),
    pastHolidays: new Set(),
  });
  const cell = (d: string) => r.cells.find((c) => c.date === d)!;
  assert.equal(r.perStaff.T, 1_500_000); // trung vị của 2tr/người & 1tr/người
  assert.equal(cell("2026-11-21").suggest, 4); // 6tr / 1,5tr
  assert.equal(cell("2026-11-23").suggest, 1); // 2tr / 1,5tr ≈ 1
  assert.equal(cell("2026-11-21").rev, 6_000_000);
  assert.equal(cell("2026-11-20").samples, 0); // không có dữ liệu → giữ định mức hiện tại
  assert.equal(cell("2026-11-20").suggest, 2);
  assert.equal(r.holidayFactor, 1.5);
});
