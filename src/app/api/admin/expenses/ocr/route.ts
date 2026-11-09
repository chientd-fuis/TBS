import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/admin-session";
import { can } from "@/lib/permissions";
import { geminiConfigured, readStatementPhoto } from "@/lib/ocr";
import { detectSalary, EXPENSE_CATEGORIES } from "@/lib/finance";
import { connectDB } from "@/lib/db";
import { Expense, User } from "@/lib/models";
import { HttpError, jsonError } from "@/lib/api";
import { localDate } from "@/lib/time";

// Gemini API không hỗ trợ Hong Kong → chạy hàm này ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;
const Body = z.object({ photo: z.string().startsWith("data:image/") });

/**
 * Đọc 1 ảnh sao kê (nhiều giao dịch) / biên lai CK / bill (1 giao dịch) bằng Gemini → các giao dịch TIỀN RA.
 * Gắn gợi ý: trả lương NV (không cộng chi phí), có thể trùng khoản đã nhập.
 */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    if (!can(admin, "finance.bills")) throw new HttpError(403, "Bạn chưa được cấp quyền Bill / chuyển khoản");
    if (!geminiConfigured()) throw new HttpError(503, "Chưa cấu hình GEMINI_API_KEY – nhập tay", { code: "OCR_OFF" });
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, "Thiếu ảnh");
    const txs = await readStatementPhoto(p.data.photo, localDate(new Date()), EXPENSE_CATEGORIES.map((c) => c.key)).catch((e: Error) => {
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    await connectDB();
    const staff = (await User.find({ status: { $in: ["ACTIVE", "INACTIVE"] } }).select("name").lean()).map((u) => u.name ?? "").filter(Boolean);
    const dupes = txs.length
      ? await Expense.find({ $or: txs.filter((t) => t.date).map((t) => ({ date: t.date, amount: t.amount })) }).select("date amount items vendor").lean()
      : [];
    const out = txs.map((t) => {
      const hint = detectSalary({ vendor: t.recipient, transferNote: t.transferNote, items: t.purpose }, staff);
      const dup = dupes.find((d) => d.date === t.date && d.amount === t.amount);
      // lương chỉ khi nội dung ghi rõ; AI chọn LUONG mà nội dung không rõ → Khác
      const category = hint?.strong ? "LUONG" : t.category === "LUONG" ? "KHAC" : (t.category ?? "KHAC");
      return {
        ...t,
        category,
        ...(hint ? { salaryHint: hint.strong ? hint.text : `${hint.text} – nếu là lương thì chọn mục Lương` } : {}),
        ...(dup ? { dupHint: `Đã có khoản ${dup.amount.toLocaleString("vi-VN")} đ ngày này${dup.items || dup.vendor ? ` (${dup.items || dup.vendor})` : ""}` } : {}),
      };
    });
    return NextResponse.json({ ok: true, transactions: out });
  } catch (e) {
    return jsonError(e);
  }
}
