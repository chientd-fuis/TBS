// Kiểm tra kết nối MongoDB: node scripts/check-db.mjs
import fs from "node:fs";
import mongoose from "mongoose";

const fromWin = process.env.MONGODB_URI;
let fromFile = "";
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*MONGODB_URI\s*=\s*"?(.*?)"?\s*$/);
  if (m) fromFile = m[1];
}
if (fromWin) console.log("!! Windows đang có biến MONGODB_URI → app dùng biến này, BỎ QUA .env.local");
const uri = fromWin || fromFile;
const u = new URL(uri);
const pw = decodeURIComponent(u.password);
console.log("Nguồn     :", fromWin ? "biến môi trường Windows" : ".env.local");
console.log("User      :", decodeURIComponent(u.username));
console.log("Host      :", u.host, " DB:", u.pathname);
console.log("Mật khẩu  :", `${pw.length} ký tự, bắt đầu '${pw[0]}', kết thúc '${pw.at(-1)}'`);
try {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  console.log("✅ KẾT NỐI THÀNH CÔNG");
} catch (e) {
  console.log("❌", e.message);
}
await mongoose.disconnect();
