import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/admin-session";
import { connectDB } from "@/lib/db";
import { ShiftTemplate } from "@/lib/models";
import { HttpError, jsonError } from "@/lib/api";
import { geminiConfigured, readAttendancePhotos } from "@/lib/ocr";
import { normalizeAiAttendance } from "@/lib/attendance-import";

// Gemini API không hỗ trợ Hong Kong → chạy ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;
const Body = z.object({ photo: z.string().startsWith("data:image/"), store: z.string(), month: z.string().regex(/^\d{4}-\d{2}$/) });

/** AI đọc 1 ảnh bảng chấm công → các lượt (tên NV, ngày, giờ vào/ra, ca). Chưa ghi gì vào database. */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    if (!geminiConfigured()) throw new HttpError(503, "Chưa cấu hình GEMINI_API_KEY", { code: "OCR_OFF" });
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, "Thiếu ảnh");
    await connectDB();
    const templates = (await ShiftTemplate.find({ storeId: p.data.store, active: { $ne: false } }).sort({ startTime: 1 }).lean().catch(() => [])).map((t) => ({
      name: t.name,
      startTime: t.startTime,
      endTime: t.endTime,
    }));
    const json = await readAttendancePhotos([p.data.photo], p.data.month, templates.map((t) => `${t.name} (${t.startTime}–${t.endTime})`), `admin:${admin.accountId ?? "owner"}`).catch((e: Error) => {
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    return NextResponse.json({ ok: true, records: normalizeAiAttendance(json, p.data.month, templates) });
  } catch (e) {
    return jsonError(e);
  }
}
