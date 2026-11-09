import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiGenerate, geminiKeys } from "../src/lib/ocr";

test("Gemini: đọc danh sách key (GEMINI_API_KEY, dấu phẩy, _2…_9), bỏ trùng", () => {
  assert.deepEqual(geminiKeys({ GEMINI_API_KEY: "a, b", GEMINI_API_KEY_2: "c", GEMINI_API_KEY_3: "a", GEMINI_API_KEY_9: " d " }), ["a", "b", "c", "d"]);
  assert.deepEqual(geminiKeys({}), []);
});

test("Gemini: key 1 hết lượt miễn phí → tự chuyển sang key 2", async () => {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = "k1";
  process.env.GEMINI_API_KEY_2 = "k2";
  process.env.GEMINI_MODEL = "m";
  process.env.GEMINI_FALLBACK_MODELS = "";
  const calls: string[] = [];
  globalThis.fetch = (async (_url: string, init: { headers: Record<string, string> }) => {
    const key = init.headers["x-goog-api-key"];
    calls.push(key);
    if (key === "k1")
      return new Response(
        JSON.stringify({ error: { code: 429, message: "free tier", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "20" }] }] } }),
        { status: 429 },
      );
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok từ key 2" }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  try {
    assert.equal(await geminiGenerate({ prompt: "x" }), "ok từ key 2");
    assert.deepEqual(calls, ["k1", "k2"]);
    // lần sau: key 1 đang bị đánh dấu hết lượt → gọi thẳng key 2
    calls.length = 0;
    assert.equal(await geminiGenerate({ prompt: "x" }), "ok từ key 2");
    assert.deepEqual(calls, ["k2"]);
  } finally {
    globalThis.fetch = realFetch;
    process.env = env;
  }
});
