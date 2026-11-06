"use server";
import { revalidatePath } from "next/cache";
import { Store } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { deliverClosing } from "@/lib/closing";
import { sendTelegramText } from "@/lib/telegram";
import { errMsg, str, type FormState } from "./types";

export async function resendClosing(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const st = await deliverClosing(id);
    await audit(adminActor(admin), "closing.resend", { type: "ShiftClosing", id }, null, { status: st });
    revalidatePath("/admin/closings");
    return st === "SENT" ? { ok: true } : { error: "Gửi chưa được – xem lỗi ở cột Telegram" };
  } catch (e) {
    return errMsg(e);
  }
}

/** Gửi tin nhắn thử vào nhóm Telegram của cơ sở (kiểm tra bot token / chat ID). */
export async function testTelegram(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await assertAdmin();
    const store = await Store.findById(str(fd.get("storeId"))).lean();
    const chatId = str(fd.get("chatId")) || store?.telegramChatId || process.env.TELEGRAM_CHAT_ID || "";
    await sendTelegramText(chatId, `✅ Tiệm Bơ Sầu – kết nối nhóm chốt ca cho ${store?.name ?? "cơ sở"} thành công.`);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
