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
    const attendance = str(fd.get("kind")) === "attendance";
    const chatId = attendance
      ? store?.telegramAttendanceChatId || process.env.TELEGRAM_ATTENDANCE_CHAT_ID || ""
      : str(fd.get("chatId")) || store?.telegramChatId || process.env.TELEGRAM_CHAT_ID || "";
    await sendTelegramText(chatId, `✅ Tiệm Bơ Sầu – kết nối nhóm ${attendance ? "chấm công" : "chốt ca"} cho ${store?.name ?? "cơ sở"} thành công.`);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Ghi lại doanh thu 1 ngày lên Google Sheet (admin bấm tay). */
export async function syncDayRevenue(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const storeId = str(fd.get("storeId"));
    const date = str(fd.get("date"));
    const { recomputeDay, syncDaySheet } = await import("@/lib/day-revenue");
    await recomputeDay(storeId, date);
    const st = await syncDaySheet(storeId, date);
    await audit(adminActor(admin), "revenue.sheetSync", { type: "Store", id: storeId }, null, { date, status: st });
    revalidatePath("/admin/closings");
    return st === "SENT" ? { ok: true } : { error: "Chưa ghi được – xem lỗi ở cột Google Sheet" };
  } catch (e) {
    return errMsg(e);
  }
}

/** Admin sửa số liệu doanh thu của 1 lượt chốt ca → cộng lại ngày (ngày đã ghi sheet thì ghi lại). */
export async function editClosingRevenue(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const { ShiftClosing } = await import("@/lib/models");
    const { evalMoneyExpr, REVENUE_KEYS } = await import("@/lib/revenue");
    const { recomputeDay, syncDaySheet } = await import("@/lib/day-revenue");
    const c = await ShiftClosing.findById(id);
    if (!c) return { error: "Không tìm thấy lượt chốt ca" };
    const before = c.toObject().revenue;
    const revenue: Record<string, number> = {};
    const revenueInput: Record<string, string> = {};
    for (const k of REVENUE_KEYS) {
      const raw = str(fd.get(k));
      const r = evalMoneyExpr(raw);
      if (!r.ok) return { error: `Ô ${k} có khoản không có số tiền` };
      if (k !== "cp" && r.value < 0) return { error: "Số tiền không được âm" };
      revenue[k] = r.value;
      revenueInput[k] = raw;
    }
    c.set({ revenue, revenueInput, revenueEditedBy: adminActor(admin).name });
    await c.save();
    await audit(adminActor(admin), "closing.revenue.edit", { type: "ShiftClosing", id }, before, revenue);
    const { wasSynced, changed } = await recomputeDay(c.storeId, c.workDate);
    if (wasSynced && changed) await syncDaySheet(c.storeId, c.workDate);
    revalidatePath("/admin/closings");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Kiểm tra quyền ghi Google Sheet + tab tháng hiện tại của cơ sở. */
export async function testRevenueSheet(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await assertAdmin();
    const store = await Store.findById(str(fd.get("storeId"))).lean();
    if (!store) return { error: "Không tìm thấy cơ sở" };
    const { checkSheet } = await import("@/lib/sheets");
    const { localMonth } = await import("@/lib/time");
    const r = await checkSheet(store, localMonth(new Date(), store.timezone || undefined));
    if (!r.hasTab) return { error: `Kết nối được file "${r.title}" nhưng chưa có tab "${r.tab}" (đang có: ${r.tabs.join(", ")})` };
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    if (/DECODER routines|unsupported|PEM|private key|invalid_grant/i.test(msg))
      return { error: "Private key của service account sai định dạng – dán lại (nên dùng biến GOOGLE_SA_JSON chứa nguyên file JSON)" };
    return { error: /permission|403/i.test(msg) ? "Service account chưa được share quyền chỉnh sửa file sheet" : msg };
  }
}

/** Xoá hẳn 1 lượt chốt ca → cộng lại doanh thu ngày (ngày đã ghi sheet thì ghi lại số mới). */
export async function deleteClosing(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const { ShiftClosing, DayRevenue } = await import("@/lib/models");
    const { recomputeDay, syncDaySheet } = await import("@/lib/day-revenue");
    const c = await ShiftClosing.findById(id).lean();
    if (!c) return { error: "Không tìm thấy lượt chốt ca" };
    await ShiftClosing.deleteOne({ _id: id });
    await audit(adminActor(admin), "closing.delete", { type: "ShiftClosing", id }, c, null);
    const { day, wasSynced, changed } = await recomputeDay(c.storeId, c.workDate);
    if (wasSynced && changed) await syncDaySheet(c.storeId, c.workDate);
    else if (!day.closings && !wasSynced) await DayRevenue.deleteOne({ _id: day._id }); // ngày không còn lượt chốt nào
    revalidatePath("/admin/closings");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
