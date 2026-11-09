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
  assert.deepEqual(s.features.ask, { enabled: false, limit: 5, model: "gemini-2.5-flash-lite" });
  assert.equal(s.features.assistant.enabled, true);
  assert.equal(s.assistant.rules, "Đến sớm 5 phút");
  assert.ok(s.assistant.closing.length > 20);
});
