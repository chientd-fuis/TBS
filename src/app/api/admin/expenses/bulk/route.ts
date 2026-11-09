import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdmin, adminActor } from "@/lib/admin-session";
import { can } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { Expense, Store } from "@/lib/models";
import { audit } from "@/lib/audit";
import { formatExpenseBatchCaption, isCategory } from "@/lib/finance";
import { financeChatId } from "@/lib/finance-report";
import { sendPhotosToTelegram, sendTelegramText, telegramConfigured } from "@/lib/telegram";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";
import { isYmd } from "@/lib/time";

export const maxDuration = 60;

const Row = z.object({
  date: z.string().refine(isYmd, "Có dòng sai ngày"),
  amount: z.number().int().positive("Số tiền phải > 0").max(10_000_000_000),
  category: z.string().refine(isCategory, "Danh mục không hợp lệ"),
  target: z.string(), // storeId | "SHARED" (= tất cả cơ sở, chia theo allocation)
  content: z.string().max(300).optional(), // nội dung chi tiết (= nội dung CK)
  recipient: z.string().max(120).optional(),
  countInCost: z.boolean(),
  fromOcr: z.boolean().optional(),
});
const Body = z.object({
  photos: z.array(z.string().startsWith("data:image/")).max(10).default([]),
  rows: z.array(Row).min(1, "Chưa có khoản nào").max(100),
  allocation: z.enum(["REVENUE", "EQUAL"]).default("REVENUE"),
});

/** Lưu nhiều khoản chi (từ ảnh sao kê / biên lai CK / nhập tay) → 1 tin (kèm ảnh) vào nhóm Quản lý doanh thu. */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    if (!can(admin, "finance.bills")) throw new HttpError(403, "Bạn chưa được cấp quyền Bill / chuyển khoản");
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ");
    const { rows, photos, allocation } = p.data;
    await connectDB();
    const stores = await Store.find().select("name").lean();
    const storeName = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
    if (rows.some((r) => r.target !== "SHARED" && !storeName.has(r.target))) throw new HttpError(400, "Có dòng chưa chọn cơ sở");
    const actor = adminActor(admin);
    const docs = await Expense.insertMany(
      rows.map((r) => ({
        date: r.date,
        month: r.date.slice(0, 7),
        amount: r.amount,
        category: r.category,
        vendor: r.recipient?.trim() || undefined,
        items: r.content?.trim() || undefined,
        kind: "TRANSFER",
        countInCost: r.countInCost,
        scope: r.target === "SHARED" ? "SHARED" : "STORE",
        ...(r.target !== "SHARED" ? { storeId: r.target } : {}),
        allocation,
        paidFrom: "OWNER",
        ocr: { status: r.fromOcr ? "OK" : "NONE" },
        telegram: { status: "PENDING" },
        createdBy: actor.name,
      })),
    );
    const ids = docs.map((d) => d._id);
    await audit(actor, "expense.bulkCreate", { type: "Expense", id: String(ids[0]) }, null, { count: rows.length, ids: ids.map(String) });

    let telegram: "SENT" | "FAILED" | "DISABLED" = "DISABLED";
    let error: string | undefined;
    const chat = await financeChatId();
    if (telegramConfigured() && chat) {
      const caption = formatExpenseBatchCaption(
        rows.map((r) => ({ ...r, target: r.target === "SHARED" ? "" : storeName.get(r.target)! })),
        actor.name,
      );
      try {
        const msgIds: number[] = [];
        if (photos.length) {
          // caption ảnh tối đa 1024 ký tự → dài thì gửi ảnh (dòng tiêu đề) + tin nhắn chữ đầy đủ
          const short = caption.length <= 1000;
          msgIds.push(...(await sendPhotosToTelegram(chat, photos.map(dataUrlToBuffer), short ? caption : caption.split("\n")[0])));
          if (!short) msgIds.push(await sendTelegramText(chat, caption.slice(0, 4000)));
        } else msgIds.push(await sendTelegramText(chat, caption.slice(0, 4000)));
        telegram = "SENT";
        await Expense.updateMany({ _id: { $in: ids } }, { $set: { "telegram.status": "SENT", "telegram.messageIds": msgIds } });
      } catch (e) {
        telegram = "FAILED";
        error = (e as Error).message;
        await Expense.updateMany({ _id: { $in: ids } }, { $set: { "telegram.status": "FAILED", "telegram.error": error } });
      }
    } else await Expense.updateMany({ _id: { $in: ids } }, { $set: { "telegram.status": "DISABLED" } });

    return NextResponse.json({
      ok: true,
      count: rows.length,
      telegram,
      message:
        telegram === "SENT"
          ? `Đã lưu ${rows.length} khoản và gửi vào nhóm Quản lý doanh thu.`
          : telegram === "DISABLED"
            ? `Đã lưu ${rows.length} khoản (chưa cấu hình nhóm Telegram Quản lý doanh thu).`
            : `Đã lưu ${rows.length} khoản, gửi Telegram lỗi: ${error}`,
    });
  } catch (e) {
    return jsonError(e);
  }
}
