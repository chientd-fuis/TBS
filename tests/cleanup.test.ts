import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_KEYS_UI, CLEANUP_ITEMS, CLEANUP_KEYS, fmtBytes } from "../src/lib/cleanup-items";
import { latestCutoff, safeCutoff, summarize } from "../src/lib/cleanup";

test("mỗi loại dọn có đúng 1 mục giao diện", () => {
  assert.deepEqual([...CLEANUP_ITEMS.map((i) => i.key)].sort(), [...CLEANUP_KEYS].sort());
});

test("tự dọn hằng tháng chỉ gồm loại an toàn", () => {
  for (const k of ["photos", "junkUsers", "devices", "faces", "auditLogs", "adjustLogs"]) assert.ok(!AUTO_KEYS_UI.includes(k as never), k);
  assert.ok(AUTO_KEYS_UI.includes("notices"));
});

test("giữ tháng này + 2 tháng trước", () => {
  assert.equal(safeCutoff(new Date("2026-11-08T05:00:00Z")), "2026-09");
  assert.equal(safeCutoff(new Date("2026-01-31T20:00:00Z")), "2025-12"); // đã là 01/02 giờ VN
});

test("chọn tay xa nhất: xoá cả tháng này (mốc = tháng sau)", () => {
  assert.equal(latestCutoff(new Date("2026-11-08T05:00:00Z")), "2026-12");
  assert.equal(latestCutoff(new Date("2026-12-31T18:00:00Z")), "2027-02"); // 01/01/2027 giờ VN
});

test("summarize bỏ dòng 0", () => {
  const lines = summarize({
    notices: { total: 5, parts: [["thông báo", 5]] },
    requests: { total: 3, parts: [["đơn nhờ làm hộ cũ", 3], ["ca bị từ chối", 0]] },
    orphans: { total: 0, parts: [["x", 0]] },
    driveFolders: 2,
  });
  assert.deepEqual(lines, ["• Thông báo của nhân viên: 5 thông báo", "• Yêu cầu đã xử lý xong: 3 đơn nhờ làm hộ cũ", "• 2 thư mục ảnh Drive → thùng rác"]);
});

test("fmtBytes", () => {
  assert.equal(fmtBytes(512 * 1024 ** 2), "512.0 MB");
  assert.equal(fmtBytes(2048), "2 KB");
});

test("không còn lựa chọn dọn chốt ca / doanh thu (doanh thu tháng cũ phải giữ để tính Lãi lỗ)", () => {
  assert.ok(!(CLEANUP_KEYS as readonly string[]).includes("closings"));
});
