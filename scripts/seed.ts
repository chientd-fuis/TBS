/**
 * Khởi tạo dữ liệu: Settings + 3 cơ sở mặc định (TBS Geleximco, TBS Văn Phú, TBS Đô Nghĩa).
 * Chạy: npm run seed   (cần MONGODB_URI trong .env.local hoặc biến môi trường)
 * Ghi chú: app cũng tự seed khi chạy lần đầu, script này chỉ để chủ động khởi tạo.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const { ensureSeed } = await import("../src/lib/settings");
  const { Store } = await import("../src/lib/models");
  const mongoose = (await import("mongoose")).default;
  await ensureSeed();
  await Promise.all(
    ["Settings", "Store", "User", "FaceProfile", "Device", "LoginLog", "ShiftTemplate", "ShiftAssignment", "Attendance", "BonusPenalty", "Payroll", "PayrollItem"].map((n) =>
      mongoose.model(n).syncIndexes(),
    ),
  );
  const stores = await Store.find().lean();
  console.log("Cơ sở:", stores.map((s) => `${s.code} – ${s.name}`).join(", "));
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
