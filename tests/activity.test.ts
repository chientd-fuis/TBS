import { test } from "node:test";
import assert from "node:assert/strict";
import { actionMeta, actionsOf, describe, refsOf, vnTime } from "../src/lib/activity";

const names = { users: new Map([["u1", "Lê Nga"], ["u2", "Hữu Úc"]]), stores: new Map([["s1", "Văn Phú"]]) };

test("nhãn hành động + nhóm", () => {
  assert.deepEqual(actionMeta("bonusPenalty.create"), { group: "bonus", label: "Thêm thưởng / phạt" });
  assert.equal(actionMeta("x.y").label, "x.y");
  assert.ok(actionsOf("schedule").includes("schedule.approve"));
});

test("mô tả: thưởng phạt", () => {
  assert.equal(describe("bonusPenalty.create", { userId: "u1", kind: "PENALTY", amountVnd: 50000, content: "Đi muộn", date: "2026-11-08" }, names), "Lê Nga · 08/11 · phạt 50.000đ · “Đi muộn”");
});

test("mô tả: chấm công hộ có giờ VN", () => {
  const d = { userId: "u2", storeId: "s1", checkInAt: new Date("2026-11-08T01:00:00Z"), checkOutAt: new Date("2026-11-08T06:30:00Z"), reason: "Hết pin" };
  assert.equal(describe("attendance.manual", d, names), "Hữu Úc · Văn Phú · 08/11 08:00→13:30 · “Hết pin”");
  assert.equal(vnTime("2026-11-08T17:05:00Z"), "00:05 09/11");
});

test("mô tả: hàng loạt + nhờ làm hộ", () => {
  assert.equal(describe("attendance.bulk", { userIds: ["u1", "u2"], from: "2026-11-02", to: "2026-11-06", created: 10, reason: "Chấm hộ hàng loạt" }, names), "Lê Nga, Hữu Úc · 02/11–06/11 · 10 mục · “Chấm hộ hàng loạt”");
  assert.equal(describe("cover.approve", { fromUserId: "u1", toUserId: "u2", date: "2026-11-09", shiftName: "Ca Tối" }, names), "Lê Nga → Hữu Úc · Ca Tối · 09/11");
});

test("refsOf lấy id cần tra tên", () => {
  const r = refsOf({ userId: "u1", userIds: ["u2"], storeId: "s1" });
  assert.deepEqual([...r.users], ["u1", "u2"]);
  assert.deepEqual([...r.stores], ["s1"]);
});
