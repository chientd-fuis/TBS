/**
 * Dọn ghi chú phụ cấp / tạm ứng rác trong dòng lương:
 *  - ghi chú do Trợ lý AI tự thêm (note "Trợ lý AI" hoặc trống);
 *  - ghi chú lệch số: tổng ghi chú của 1 cột lớn hơn số tiền cột đó (VD số đã về 0 mà ghi chú còn).
 * Chạy thử (không ghi):  npx tsx scripts/clean-extras-notes.ts
 * Xoá thật:              npx tsx scripts/clean-extras-notes.ts --apply
 */
import { loadEnv } from "./env";
loadEnv();

async function main() {
  const apply = process.argv.includes("--apply");
  const { connectDB } = await import("../src/lib/db");
  const { PayrollItem } = await import("../src/lib/models");
  const mongoose = (await import("mongoose")).default;
  await connectDB();
  type Note = { field?: string | null; amount?: number | null; note?: string | null };
  const items = await PayrollItem.find({ "extrasNotes.0": { $exists: true } }).select("month userName allowance advance extrasNotes").lean();
  let changed = 0;
  let removed = 0;
  for (const it of items) {
    const notes = (it.extrasNotes ?? []) as Note[];
    let keep = notes.filter((n) => (n.note ?? "").trim() && n.note!.trim() !== "Trợ lý AI");
    for (const f of ["allowance", "advance"] as const) {
      const sum = keep.filter((n) => n.field === f).reduce((s, n) => s + (n.amount ?? 0), 0);
      if (sum > (it[f] || 0)) keep = keep.filter((n) => n.field !== f);
    }
    if (keep.length === notes.length) continue;
    changed++;
    removed += notes.length - keep.length;
    console.log(`${it.month} ${it.userName ?? it._id}: xoá ${notes.length - keep.length}/${notes.length} ghi chú`, notes.filter((n) => !keep.includes(n)).map((n) => `${n.field} ${n.amount} "${n.note}"`).join("; "));
    if (apply) await PayrollItem.updateOne({ _id: it._id }, { $set: { extrasNotes: keep } });
  }
  console.log(`${apply ? "ĐÃ XOÁ" : "Chạy thử – sẽ xoá"} ${removed} ghi chú ở ${changed} dòng lương.${apply ? "" : " Thêm --apply để xoá thật."}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
