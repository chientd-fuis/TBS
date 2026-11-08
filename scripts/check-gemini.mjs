// Kiểm tra key Gemini: liệt kê model dùng được + gọi thử từng model nên dùng.
// Chạy: npm run check-gemini   (đọc GEMINI_API_KEY từ .env.local hoặc biến môi trường)
import { readFileSync } from "node:fs";

function envFromFile() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
envFromFile();
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error("❌ Chưa có GEMINI_API_KEY trong .env.local");
  process.exit(1);
}
const BASE = "https://generativelanguage.googleapis.com/v1beta";
const H = { "x-goog-api-key": key, "content-type": "application/json" };

// 1) Danh sách model key này được dùng
let models = [];
let pageToken = "";
do {
  const r = await fetch(`${BASE}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: H });
  const j = await r.json();
  if (!r.ok) {
    console.error(`❌ Key lỗi (HTTP ${r.status}): ${j.error?.message}`);
    process.exit(1);
  }
  models.push(...(j.models ?? []));
  pageToken = j.nextPageToken ?? "";
} while (pageToken);

const usable = models
  .filter((m) => m.supportedGenerationMethods?.includes("generateContent") && /gemini/.test(m.name))
  .map((m) => m.name.replace("models/", ""))
  .sort();
console.log(`✅ Key hợp lệ – ${usable.length} model Gemini đọc được ảnh/văn bản:`);
for (const n of usable) console.log("   •", n);

// 2) Gọi thử các model ứng viên cho chốt ca (biết ngay model nào bị giới hạn / chưa bật billing)
const CANDIDATES = [process.env.GEMINI_MODEL, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview"].filter(
  (v, i, a) => v && a.indexOf(v) === i,
);
console.log("\nGọi thử:");
for (const m of CANDIDATES) {
  if (!usable.includes(m)) {
    console.log(`   ⚪ ${m}: không có trong danh sách của key này`);
    continue;
  }
  const t = Date.now();
  const r = await fetch(`${BASE}/models/${m}:generateContent`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ contents: [{ parts: [{ text: 'Trả về JSON {"ok":true}' }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  const j = await r.json().catch(() => ({}));
  if (r.ok) console.log(`   🟢 ${m}: OK (${Date.now() - t} ms)`);
  else if (r.status === 429) console.log(`   🟠 ${m}: hết lượt / bị giới hạn (429) – ${j.error?.message?.slice(0, 120)}`);
  else console.log(`   🔴 ${m}: HTTP ${r.status} – ${j.error?.message?.slice(0, 160)}`);
}
console.log("\nĐang dùng trong app:", process.env.GEMINI_MODEL || "gemini-2.5-flash (mặc định)");
