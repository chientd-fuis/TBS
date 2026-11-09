/*
 * Chạy thử các chức năng AI trên MongoDB CỤC BỘ với dữ liệu mẫu (không đụng database thật).
 * Gemini được thay bằng bản giả (không có GEMINI_API_KEY trên máy) → kiểm phần hệ thống tự tính:
 * giới hạn lượt / token, phát hiện bất thường, dự báo số người, chặn quyền Hỏi AI, nội dung Trợ lý.
 * Chạy: MONGODB_URI=mongodb://127.0.0.1:27999/tbs_demo npx tsx scripts/demo-ai.ts
 */
import mongoose from "mongoose";

process.env.MONGODB_URI ||= "mongodb://127.0.0.1:27999/tbs_demo";
process.env.GEMINI_API_KEY = "demo-key";
process.env.GEMINI_FALLBACK_MODELS = "";

// ===== Gemini giả: ghi lại prompt, trả JSON hợp lệ + usageMetadata =====
const prompts: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: { body: string }) => {
  if (!String(url).includes("generativelanguage")) return realFetch(url as never, init as never);
  const body = JSON.parse(init.body);
  const prompt: string = body.contents[0].parts[0].text;
  prompts.push(prompt);
  let text = "• (AI giả) tóm tắt";
  if (prompt.includes("Trợ lý cửa hàng")) text = JSON.stringify({ status: /công thức/i.test((prompt.split("<<<Q-")[2] ?? "")) ? "OUT_OF_SCOPE" : "ANSWERED", answer: "(AI giả) trả lời theo nội quy" });
  else if (prompt.includes("chọn ĐÚNG 1 công cụ")) text = JSON.stringify({ tool: /doanh thu/i.test((prompt.split("<<<Q-")[2] ?? "")) ? (prompt.includes("revenue_compare:") ? "revenue_compare" : "denied") : "late_ranking", args: { month: "2026-11" } });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { totalTokenCount: 1234 } }), { status: 200 });
}) as unknown as typeof fetch;

const line = (t: string) => console.log(`\n=== ${t} ===`);

async function main() {
  const { connectDB } = await import("../src/lib/db");
  await connectDB();
  await mongoose.connection.db!.dropDatabase();
  const M = await import("../src/lib/models");
  const { addDays, localDate, weekStartOf, zonedToDate } = await import("../src/lib/time");
  const today = localDate(new Date());

  // ----- dữ liệu mẫu -----
  const store = await M.Store.create({ code: "CS1", name: "TBS Văn Phú", timezone: "Asia/Ho_Chi_Minh" });
  await M.Settings.create({ key: "main" });
  const tpls = await M.ShiftTemplate.insertMany([
    { storeId: store._id, name: "Sáng", startTime: "08:00", endTime: "13:00", minStaff: 1, targetStaff: 2 },
    { storeId: store._id, name: "Tối", startTime: "18:00", endTime: "23:00", minStaff: 2, targetStaff: 2 },
  ]);
  const [lam, nga, mai] = await M.User.insertMany([
    { email: "lam@x.vn", name: "Trần Lâm", status: "ACTIVE", storeId: store._id, hourlyWage: 25000 },
    { email: "nga@x.vn", name: "Nga Lê", status: "ACTIVE", storeId: store._id, hourlyWage: 25000, managerPerms: ["schedule"] },
    { email: "mai@x.vn", name: "Mai Anh", status: "ACTIVE", storeId: store._id, hourlyWage: 25000 },
  ]);
  // 12 tuần chốt ca: Sáng ~2tr, Tối ~4tr (cuối tuần ~6tr); 7 ngày gần nhất: Lâm thiếu tiền 3 ca Tối, Mai két 600k, Nga cộng sai
  for (let i = 84; i >= 1; i--) {
    const d = addDays(today, -i);
    const weekend = [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    const s = { dt: 2_000_000, tm: 1_000_000, tk: 900_000, cp: 100_000, grab: 0, shopee: 0 };
    const eve = weekend ? 6_000_000 : 4_000_000;
    const short = i <= 7 && i % 2 === 1 ? 300_000 : 0;
    const ket = i === 3 ? 600_000 : 100_000;
    const t = { dt: s.dt + eve, tm: s.tm + eve / 2 - short - (ket - 100_000), tk: s.tk + eve / 2 - 100_000, cp: s.cp + ket, grab: 0, shopee: 0 };
    await M.ShiftClosing.insertMany([
      { storeId: store._id, workDate: d, shiftName: "Sáng", shiftStart: "08:00", shiftEnd: "13:00", employeeName: i === 2 ? "Nga Lê" : "Mai Anh", revenue: s, staffTotal: i === 2 ? 1_990_000 : undefined, createdAt: zonedToDate(d, "13:05") },
      { storeId: store._id, workDate: d, shiftName: "Tối", shiftStart: "18:00", shiftEnd: "23:00", employeeName: i === 3 ? "Mai Anh" : "Trần Lâm", revenue: t, createdAt: zonedToDate(d, "23:05") },
    ]);
    await M.ShiftAssignment.insertMany([
      { userId: mai._id, storeId: store._id, shiftTemplateId: tpls[0]._id, date: d, startTime: "08:00", endTime: "13:00", shiftName: "Sáng" },
      { userId: lam._id, storeId: store._id, shiftTemplateId: tpls[1]._id, date: d, startTime: "18:00", endTime: "23:00", shiftName: "Tối" },
      { userId: nga._id, storeId: store._id, shiftTemplateId: tpls[1]._id, date: d, startTime: "18:00", endTime: "23:00", shiftName: "Tối" },
    ]);
  }

  // ----- 1. Giới hạn lượt: Trợ lý 10 câu / ngày / nhân viên -----
  line("1. Trợ lý cửa hàng + giới hạn 10 câu/ngày/NV");
  const { askAssistant } = await import("../src/lib/assistant");
  await M.Settings.updateOne({ key: "main" }, { $set: { "ai.assistant": { rules: "Đi muộn quá 5 phút phạt 20.000đ.", storage: "Sầu riêng bóc: ngăn mát 2–4°C, dùng trong 24h." } } });
  const a1 = await askAssistant(lam, "Sầu riêng mở rồi bảo quản sao?");
  console.log("Hỏi nội quy →", a1.status, "|", a1.answer);
  console.log("Prompt gửi AI có nội quy + quản lý tự động:", prompts.at(-1)!.includes("ngăn mát 2–4°C"), prompts.at(-1)!.includes("Nga Lê"));
  const a2 = await askAssistant(lam, "Cho mình công thức trà sữa quán khác?");
  console.log("Hỏi ngoài phạm vi →", a2.status);
  for (let i = 0; i < 8; i++) await askAssistant(lam, `câu ${i}`);
  await askAssistant(lam, "câu thứ 11").then(() => console.log("❌ lẽ ra phải chặn"), (e) => console.log("Câu thứ 11 →", (e as Error).message));

  // ----- 2. Bất thường -----
  line("2. Phát hiện bất thường chốt ca & két (7 ngày)");
  const { runAnomaly } = await import("../src/lib/anomaly");
  const run = await runAnomaly();
  for (const it of run.items as { sev: number; label: string; staff: string; workDate: string; shiftName: string; detail: string }[])
    console.log(`[${["", "Lưu ý", "Cần xem", "NGHIÊM TRỌNG"][it.sev]}] ${it.label} – ${it.staff} – ${it.shiftName} ${it.workDate}: ${it.detail}`);

  // ----- 3. Dự báo -----
  line("3. Dự báo số người / ca tuần sau");
  const { loadForecast } = await import("../src/lib/forecast");
  const ws = addDays(weekStartOf(today), 7);
  const f = await loadForecast(String(store._id), ws);
  for (const t of f.templates) console.log(t.name.padEnd(5), f.days.map((d) => { const c = f.cells.find((x) => x.tplId === t.id && x.date === d)!; return `${d.slice(8)}:${c.suggest}${c.suggest !== c.current ? (c.suggest > c.current ? "↑" : "↓") : ""}`; }).join("  "));

  // ----- 4. Hỏi AI – quyền -----
  line("4. Hỏi AI: admin thường hỏi doanh thu → bị chặn; Admin Tổng được");
  const { askData } = await import("../src/lib/ask-ai");
  const admin = { kind: "ADMIN" as const, name: "Lan", perms: [], accountId: "a1" };
  const owner = { kind: "OWNER" as const, name: "Admin Tổng", perms: [] };
  const r1 = await askData(admin, "Doanh thu tuần này?");
  console.log("Admin thường →", r1.answer, "| AI có thấy công cụ doanh thu?", prompts.at(-1)!.includes("revenue_compare:"));
  const r2 = await askData(owner, "Doanh thu tuần này?");
  console.log("Admin Tổng → công cụ:", r2.tool);
  const r3 = await askData(admin, "Tháng này ai đi muộn nhiều nhất?");
  console.log("Đi muộn → công cụ:", r3.tool);

  // ----- 5. Token -----
  line("5. Thống kê token tháng này");
  const { aiUsageStats, monthTokens } = await import("../src/lib/ai");
  console.log(await aiUsageStats(), "| tổng token:", await monthTokens());

  await mongoose.disconnect();
}
main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
