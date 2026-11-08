import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin, adminActor } from "@/lib/admin-session";
import { connectDB } from "@/lib/db";
import { Expense, Store } from "@/lib/models";
import { audit } from "@/lib/audit";
import { formatExpenseCaption, isCategory } from "@/lib/finance";
import { financeChatId } from "@/lib/finance-report";
import { sendPhotosToTelegram, sendTelegramText, telegramConfigured } from "@/lib/telegram";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";
import { isYmd, weekdayVi } from "@/lib/time";

export const maxDuration = 60;

const Body = z.object({
  id: z.string().optional(),
  photo: z.string().startsWith("data:image/").optional(),
  date: z.string().refine(isYmd, "Ngày không hợp lệ"),
  amount: z.number().int().positive("Số tiền phải > 0").max(10_000_000_000),
  category: z.string().refine(isCategory, "Danh mục không hợp lệ"),
  vendor: z.string().max(120).optional(),
  items: z.string().max(300).optional(),
  transferNote: z.string().max(200).optional(),
  kind: z.enum(["BILL", "TRANSFER"]).default("BILL"),
  note: z.string().max(500).optional(),
  scope: z.enum(["STORE", "SHARED"]),
  storeId: z.string().optional(),
  allocation: z.enum(["REVENUE", "EQUAL", "CUSTOM"]).default("REVENUE"),
  customShares: z.array(z.object({ storeId: z.string(), pct: z.number().min(0).max(100) })).optional(),
  paidFrom: z.enum(["OWNER", "CASHBOX"]).default("OWNER"),
  allowDuplicate: z.boolean().optional(),
  ocr: z.object({ status: z.enum(["NONE", "OK", "FAILED"]), amount: z.number().optional(), date: z.string().optional() }).optional(),
});

/** Thêm / sửa chi phí → gửi (kèm ảnh bill) vào nhóm Telegram "Quản lý doanh thu". Ảnh không lưu. */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const b = p.data;
    await connectDB();
    let store = null;
    if (b.scope === "STORE") {
      store = b.storeId ? await Store.findById(b.storeId).lean() : null;
      if (!store) throw new HttpError(400, "Chọn cơ sở");
    }
    if (b.scope === "SHARED" && b.allocation === "CUSTOM" && !(b.customShares ?? []).some((c) => c.pct > 0))
      throw new HttpError(400, "Nhập tỷ lệ % cho các cơ sở");
    const actor = adminActor(admin);
    const doc = {
      date: b.date,
      month: b.date.slice(0, 7),
      amount: b.amount,
      category: b.category,
      vendor: b.vendor?.trim() || undefined,
      items: b.items?.trim() || undefined,
      transferNote: b.transferNote?.trim() || undefined,
      kind: b.kind,
      note: b.note?.trim() || undefined,
      scope: b.scope,
      storeId: store?._id,
      allocation: b.allocation,
      customShares: b.scope === "SHARED" && b.allocation === "CUSTOM" ? b.customShares : [],
      paidFrom: b.paidFrom,
    };
    let saved;
    if (b.id) {
      const prev = await Expense.findById(b.id).lean();
      if (!prev) throw new HttpError(404, "Không tìm thấy chi phí");
      saved = await Expense.findByIdAndUpdate(
        b.id,
        { $set: { ...doc, updatedBy: actor.name }, ...(doc.storeId ? {} : { $unset: { storeId: 1 } }) },
        { returnDocument: "after" },
      ).lean();
      await audit(actor, "expense.update", { type: "Expense", id: b.id }, prev, doc);
    } else {
      // chống nhập trùng: cùng ngày + cùng số tiền → hỏi lại
      if (!b.allowDuplicate) {
        const dup = await Expense.findOne({ date: b.date, amount: b.amount }).lean();
        if (dup)
          throw new HttpError(409, `Đã có chi phí ${b.amount.toLocaleString("vi-VN")} đ ngày này${dup.vendor ? ` (${dup.vendor})` : ""} – có thể bị trùng bill.`, {
            code: "DUPLICATE",
          });
      }
      saved = await Expense.create({ ...doc, ocr: b.ocr ?? { status: "NONE" }, createdBy: actor.name });
      await audit(actor, "expense.create", { type: "Expense", id: String(saved._id) }, null, doc);
    }
    const id = String(saved!._id);

    // gửi nhóm Telegram
    let telegram: "SENT" | "FAILED" | "DISABLED" = "DISABLED";
    let error: string | undefined;
    const chat = await financeChatId();
    if (telegramConfigured() && chat) {
      const caption = formatExpenseCaption({
        ...doc,
        weekday: weekdayVi(b.date),
        storeName: store?.name,
        by: actor.name,
        edited: !!b.id,
      });
      try {
        const ids = b.photo ? await sendPhotosToTelegram(chat, [dataUrlToBuffer(b.photo)], caption) : [await sendTelegramText(chat, caption)];
        telegram = "SENT";
        await Expense.updateOne({ _id: id }, { $set: { "telegram.status": "SENT", "telegram.messageIds": ids }, $unset: { "telegram.error": 1 } });
      } catch (e) {
        telegram = "FAILED";
        error = (e as Error).message;
        await Expense.updateOne({ _id: id }, { $set: { "telegram.status": "FAILED", "telegram.error": error } });
      }
    } else await Expense.updateOne({ _id: id }, { $set: { "telegram.status": "DISABLED" } });

    return NextResponse.json({
      ok: true,
      id,
      telegram,
      message:
        telegram === "SENT"
          ? `Đã lưu và gửi vào nhóm Quản lý doanh thu.`
          : telegram === "DISABLED"
            ? "Đã lưu (chưa cấu hình nhóm Telegram Quản lý doanh thu)."
            : `Đã lưu, gửi Telegram lỗi: ${error}`,
    });
  } catch (e) {
    return jsonError(e);
  }
}
