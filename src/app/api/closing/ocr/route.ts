import { aiPhotoOn } from "@/lib/ai-photo";
import { NextResponse } from "next/server";
import { isProbation, PROBATION_OFF } from "@/lib/probation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { checkDeviceForAttendance } from "@/lib/device";
import { resolveClosingContext } from "@/lib/closing-context";
import { ocrConfigured, readClosingPhotos } from "@/lib/ocr";
import { HttpError, jsonError } from "@/lib/api";

// Gemini API không hỗ trợ Hong Kong (region mặc định hkg1) → chạy hàm này ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;

const Body = z.object({ photos: z.array(z.string()).min(1).max(4) });

/** Gửi ảnh chốt ca cho bot đọc số liệu → trả về số để điền sẵn vào form (nhân viên sửa tay nếu sai). */
export async function POST(req: Request) {
  try {
    // Cài đặt → Đọc ảnh bằng AI: chốt ca đang tắt
    if (!(await aiPhotoOn("closing"))) return NextResponse.json({ error: "Đọc ảnh tờ chốt ca bằng AI đang tắt – nhập số tay", code: "OCR_OFF" }, { status: 403 });
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Chưa đăng nhập");
    if (user.status !== "ACTIVE") throw new HttpError(403, "Tài khoản chưa được duyệt");
    if (isProbation(user)) throw new HttpError(403, PROBATION_OFF);
    if (!ocrConfigured()) throw new HttpError(503, "Chưa kết nối bot đọc ảnh – hãy nhập số liệu bằng tay", { code: "OCR_OFF" });
    const dev = await checkDeviceForAttendance(user._id);
    if (!dev.ok) throw new HttpError(403, dev.error);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Cần 1–4 ảnh");
    const ctx = await resolveClosingContext(user);
    if (!ctx) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
    const out = await readClosingPhotos(parsed.data.photos, {
      store: { code: ctx.store.code, name: ctx.store.name },
      workDate: ctx.workDate,
      shift: ctx.shift ? { name: ctx.shift.shiftName ?? undefined, start: ctx.shift.startTime ?? undefined, end: ctx.shift.endTime ?? undefined } : null,
      employee: user.name || user.email,
      actor: `user:${user._id}`,
    }).catch((e: Error) => {
      console.error("[closing ocr]", e.message); // chi tiết (key, model, hết lượt…) chỉ ghi log – nhân viên thấy câu chung
      throw new HttpError(502, "AI đang lỗi, không đọc được ảnh – hãy chụp/quét lại sau ít phút hoặc nhập tay.", { code: "OCR_FAILED" }, e.message);
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return jsonError(e, req);
  }
}
