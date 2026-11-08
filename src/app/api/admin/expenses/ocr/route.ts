import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/admin-session";
import { readBillPhoto } from "@/lib/ocr";
import { geminiConfigured } from "@/lib/ocr";
import { detectSalary, EXPENSE_CATEGORIES } from "@/lib/finance";
import { connectDB } from "@/lib/db";
import { User } from "@/lib/models";
import { HttpError, jsonError } from "@/lib/api";
import { localDate } from "@/lib/time";

// Gemini API không hỗ trợ Hong Kong (region mặc định hkg1) → chạy hàm này ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;
const Body = z.object({ photo: z.string().startsWith("data:image/") });

/** Đọc bill chi phí bằng Gemini → số tiền, ngày, nơi bán, nội dung, danh mục gợi ý. */
export async function POST(req: Request) {
  try {
    if (!(await getAdmin())) throw new HttpError(401, "Phiên admin đã hết hạn");
    if (!geminiConfigured()) throw new HttpError(503, "Chưa cấu hình GEMINI_API_KEY – nhập tay", { code: "OCR_OFF" });
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, "Thiếu ảnh");
    const out = await readBillPhoto(p.data.photo, localDate(new Date()), EXPENSE_CATEGORIES.map((c) => c.key)).catch((e: Error) => {
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    // người nhận trùng tên NV / nội dung "lương, tạm ứng" → gợi ý danh mục Lương (không cộng vào chi phí)
    await connectDB();
    const staff = (await User.find({ status: { $in: ["ACTIVE", "INACTIVE"] } }).select("name").lean()).map((u) => u.name ?? "").filter(Boolean);
    const salaryHint = detectSalary(out, staff);
    if (salaryHint) {
      out.salaryHint = salaryHint;
      out.category = "LUONG";
    } else if (out.category === "LUONG") out.salaryHint = "AI nhận định đây là trả lương / tạm ứng nhân viên";
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return jsonError(e);
  }
}
