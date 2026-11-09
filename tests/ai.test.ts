import { test } from "node:test";
import assert from "node:assert/strict";
import { AI_FEATURES, mergeAiConfig } from "../src/lib/ai";

test("Cài đặt AI: thiếu khoá → dùng mặc định; giữ giá trị đã lưu", () => {
  const d = mergeAiConfig(undefined);
  assert.equal(d.enabled, true);
  assert.equal(d.monthlyTokens, 3_000_000);
  assert.equal(d.features.payExplain.enabled, false); // giải thích lương: mặc định tắt
  assert.equal(d.features.assistant.limit, 10);
  assert.equal(Object.keys(d.features).length, AI_FEATURES.length);
  assert.ok(d.assistant.attendance.length > 20); // hướng dẫn chấm công có sẵn

  const s = mergeAiConfig({ enabled: false, monthlyTokens: 0, features: { ask: { enabled: false, limit: 5, model: "gemini-2.5-flash-lite" } }, assistant: { rules: "Đến sớm 5 phút" } });
  assert.equal(s.enabled, false);
  assert.equal(s.monthlyTokens, 0);
  assert.deepEqual(s.features.ask, { enabled: false, limit: 5, model: "gemini-2.5-flash-lite", roles: { admin: true, manager: false, staff: false } });
  assert.equal(s.features.assistant.enabled, true);
  assert.equal(s.assistant.rules, "Đến sớm 5 phút");
  assert.ok(s.assistant.closing.length > 20);
});

test("bật/tắt AI theo role: mặc định bật cho role có dùng, tắt được từng role, Admin Tổng / hệ thống luôn được", async () => {
  const { mergeAiConfig, roleAllowed } = await import("../src/lib/ai");
  const d = mergeAiConfig({});
  assert.deepEqual(d.features.assistant.roles, { admin: false, manager: true, staff: true });
  assert.deepEqual(d.features.ask.roles, { admin: true, manager: false, staff: false });
  const c = mergeAiConfig({ features: { assistant: { roles: { staff: false } }, ask: { roles: { admin: false, staff: true } } } });
  assert.equal(roleAllowed(c, "assistant", "staff"), false);
  assert.equal(roleAllowed(c, "assistant", "manager"), true);
  assert.equal(roleAllowed(c, "ask", "admin"), false);
  assert.equal(roleAllowed(c, "ask", "staff"), false); // nhân viên không bao giờ dùng "Hỏi đáp dữ liệu"
  assert.equal(roleAllowed(c, "ask", "owner"), true);
  assert.equal(roleAllowed(c, "assistant", "system"), true);
});
