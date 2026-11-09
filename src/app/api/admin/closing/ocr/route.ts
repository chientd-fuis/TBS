import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/admin-session";
import { connectDB } from "@/lib/db";
import { Store } from "@/lib/models";
import { ocrConfigured, readClosingPhotos } from "@/lib/ocr";
import { HttpError, jsonError } from "@/lib/api";

// Gemini API không hỗ trợ Hong Kong → chạy ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;

const Body = z.object({ photos: z.array(z.string().startsWith("data:image/")).min(1).max(4), store: z.string(), workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/** Admin: AI đọc ảnh tờ chốt ca → số liệu điền sẵn (chưa lưu gì). */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    if (!ocrConfigured()) throw new HttpError(503, "Chưa cấu hình GEMINI_API_KEY – nhập tay", { code: "OCR_OFF" });
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, "Cần 1–4 ảnh");
    await connectDB();
    const store = await Store.findById(p.data.store).select("code name").lean().catch(() => null);
    const out = await readClosingPhotos(p.data.photos, { store: { code: store?.code, name: store?.name }, workDate: p.data.workDate, actor: `admin:${admin.accountId ?? "owner"}` }).catch((e: Error) => {
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return jsonError(e);
  }
}
