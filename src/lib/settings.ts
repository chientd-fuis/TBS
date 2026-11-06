import { connectDB } from "./db";
import { Settings, Store } from "./models";

export const DEFAULT_STORES = [
  { code: "TBS-GLX", name: "TBS Geleximco" },
  { code: "TBS-VP", name: "TBS Văn Phú" },
  { code: "TBS-DN", name: "TBS Đô Nghĩa" },
];

let seeded = false;

/** Đảm bảo có document Settings + 3 cơ sở mặc định (spec 1.2). */
export async function ensureSeed() {
  if (seeded) return;
  await connectDB();
  await Settings.updateOne({ key: "main" }, { $setOnInsert: { key: "main" } }, { upsert: true });
  if ((await Store.estimatedDocumentCount()) === 0) {
    await Store.insertMany(DEFAULT_STORES.map((s) => ({ ...s, timezone: process.env.DEFAULT_TIMEZONE || "Asia/Ho_Chi_Minh" })));
  }
  seeded = true;
}

export async function getSettings() {
  await ensureSeed();
  const s = await Settings.findOne({ key: "main" }).lean();
  if (!s) throw new Error("Không tìm thấy Settings");
  return s;
}
