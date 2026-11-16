import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketOf } from "../src/lib/reminders";

test("ca được xếp → Sáng / Chiều / Tối theo tên ca", () => {
  assert.equal(bucketOf("Ca sáng", "08:00"), "Sáng");
  assert.equal(bucketOf("Sáng", "07:00"), "Sáng");
  assert.equal(bucketOf("S", "08:00"), "Sáng");
  assert.equal(bucketOf("Ca chiều", "13:00"), "Chiều");
  assert.equal(bucketOf("Tối", "18:00"), "Tối");
  assert.equal(bucketOf("Ca đêm", "22:00"), "Tối");
});

test("tên ca không rõ → theo giờ vào ca", () => {
  assert.equal(bucketOf("Part 1", "09:30"), "Sáng");
  assert.equal(bucketOf("Part 2", "14:00"), "Chiều");
  assert.equal(bucketOf("", "18:30"), "Tối");
});
