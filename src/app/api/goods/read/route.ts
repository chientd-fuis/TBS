import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin } from "@/lib/admin-session";
import { getCurrentUser } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { geminiConfigured } from "@/lib/ocr";
import { resolveClosingContext } from "@/lib/closing-context";
import { getGoodsCatalog, GOODS_OFF, goodsEnabled, markDupes, readGoods } from "@/lib/goods-server";
import { HttpError, jsonError } from "@/lib/api";
import { localDate } from "@/lib/time";

// Gemini API không hỗ trợ Hong Kong → chạy ở Singapore
export const preferredRegion = "sin1";
export const maxDuration = 60;

const Body = z.object({
  photos: z.array(z.string().startsWith("data:image/")).max(4).optional(),
  text: z.string().max(4000).optional(),
  storeId: z.string().optional(),
  /** form admin gửi kèm → đọc theo quyền admin (nhân viên đăng nhập cùng trình duyệt không bị lẫn) */
  as: z.enum(["admin", "user"]).optional(),
});

/** AI đọc ảnh chụp nhóm chat / đoạn tin nhắn nhận hàng → các lần nhận (chưa lưu – người nhập kiểm tra rồi bấm Lưu). */
export async function POST(req: Request) {
  try {
    const p = Body.safeParse(await req.json());
    if (!p.success || (!p.data.photos?.length && !p.data.text?.trim())) throw new HttpError(400, "Cần ảnh hoặc nội dung tin nhắn");
    if (!(await goodsEnabled())) throw new HttpError(403, GOODS_OFF);
    if (!geminiConfigured()) throw new HttpError(503, "Chưa cấu hình GEMINI_API_KEY – gõ tay danh sách món", { code: "OCR_OFF" });
    let actor: string;
    let storeId = "";
    let today = localDate(new Date());
    if (p.data.as === "admin") {
      const admin = await getAdmin();
      if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
      if (!can(admin, "goods")) throw new HttpError(403, "Bạn chưa được cấp quyền Nhận hàng");
      actor = `admin:${admin.accountId ?? "owner"}`;
      storeId = p.data.storeId ?? "";
    } else {
      const user = await getCurrentUser();
      if (!user) throw new HttpError(401, "Chưa đăng nhập");
      if (user.status !== "ACTIVE") throw new HttpError(403, "Tài khoản chưa được duyệt");
      const ctx = await resolveClosingContext(user);
      if (!ctx) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
      actor = `user:${user._id}`;
      storeId = String(ctx.store._id);
      today = ctx.today;
    }
    const catalog = await getGoodsCatalog();
    const drafts = await readGoods({ photos: p.data.photos, text: p.data.text }, catalog, today, actor).catch((e: Error) => {
      throw new HttpError(502, e.message, { code: "OCR_FAILED" });
    });
    if (!drafts.length) throw new HttpError(422, "Không thấy tin báo nhận hàng nào – chụp rõ đoạn có chữ “nhận …” hoặc gõ tay");
    return NextResponse.json({ ok: true, drafts: await markDupes(storeId, drafts) });
  } catch (e) {
    return jsonError(e);
  }
}
