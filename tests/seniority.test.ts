import { test } from "node:test";
import assert from "node:assert/strict";
import { seniorityStart, seniorityText } from "../src/lib/seniority";

test("thâm niên: lấy ngày bắt đầu sớm nhất (vào làm / ngày đi làm đầu đã lưu / chấm công còn lại)", () => {
  assert.equal(seniorityStart(["2025-06-10", "2025-03-02", null, undefined, "2025-09-01"]), "2025-03-02");
  assert.equal(seniorityStart([null, ""]), null);
});

test("thâm niên: hiển thị năm / tháng / ngày", () => {
  assert.equal(seniorityText("2024-08-12", "2026-11-12"), "2 năm 3 tháng");
  assert.equal(seniorityText("2024-11-12", "2026-11-12"), "2 năm");
  assert.equal(seniorityText("2026-05-20", "2026-11-12"), "5 tháng 23 ngày");
  assert.equal(seniorityText("2026-11-01", "2026-11-12"), "11 ngày");
  assert.equal(seniorityText("2026-12-01", "2026-11-12"), "chưa bắt đầu");
});
