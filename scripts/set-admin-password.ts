/**
 * Đặt mật khẩu admin chung từ dòng lệnh (thay cho màn hình Cài đặt của Chủ).
 * Chạy: npm run set-admin-password -- "MatKhauMoi123"
 * Tất cả phiên admin đang đăng nhập sẽ bị đăng xuất.
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const pw = process.argv[2] || "";
  if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) {
    console.error("Mật khẩu tối thiểu 8 ký tự, có chữ và số");
    process.exit(1);
  }
  const bcrypt = (await import("bcryptjs")).default;
  const { ensureSeed } = await import("../src/lib/settings");
  const { Settings } = await import("../src/lib/models");
  const mongoose = (await import("mongoose")).default;
  await ensureSeed();
  await Settings.updateOne({ key: "main" }, { $set: { adminPasswordHash: await bcrypt.hash(pw, 10), adminPasswordChangedAt: new Date() }, $inc: { adminSessionVersion: 1 } });
  console.log("Đã đặt mật khẩu admin.");
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
