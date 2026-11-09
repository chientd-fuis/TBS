import { NextResponse } from "next/server";
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
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Chưa đăng nhập");
    if (user.status !== "ACTIVE") throw new HttpError(403, "Tài khoản chưa được duyệt");
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
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return jsonError(e);
  }
}
