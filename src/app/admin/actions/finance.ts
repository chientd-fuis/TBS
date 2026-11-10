"use server";
import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { Expense, FixedCost, Settings, Store } from "@/lib/models";
import { assertAdmin, assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { formatExpenseCaption, isCategory } from "@/lib/finance";
import { financeChatId, sendDailyReport, sendMonthlyReport, sendWeeklyReport } from "@/lib/finance-report";
import { sendTelegramText, telegramConfigured } from "@/lib/telegram";
import { isYmd, weekStartOf, weekdayVi } from "@/lib/time";
import { evalMoneyExpr } from "@/lib/revenue";
import { CASH_KINDS } from "@/lib/cashbook";
import { dec, errMsg, str, type FormState } from "./types";

async function assertOwner() {
  const a = await assertAdmin();
  if (a.kind !== "OWNER") throw new Error("Chỉ Admin Tổng được làm thao tác này");
  return a;
}

export async function deleteExpense(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("finance.bills");
    await connectDB();
    const id = str(fd.get("id"));
    const e = await Expense.findById(id).lean();
    if (!e) return { error: "Không tìm thấy chi phí" };
    await Expense.deleteOne({ _id: id });
    await audit(adminActor(admin), "expense.delete", { type: "Expense", id }, e, null);
    const chat = await financeChatId();
    if (telegramConfigured() && chat) {
      const store = e.storeId ? await Store.findById(e.storeId).select("name").lean() : null;
      await sendTelegramText(
        chat,
        formatExpenseCaption({ ...e, weekday: weekdayVi(e.date), storeName: store?.name, by: adminActor(admin).name, deleted: true }),
      ).catch(() => null);
    }
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Thêm / sửa tiền thuê nhà của 1 cơ sở (chi phí cố định duy nhất) – tính mỗi tháng, chia đều theo ngày. */
export async function saveFixedCost(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("finance.rent");
    await connectDB();
    const id = str(fd.get("id"));
    const category = "MAT_BANG";
    const amt = evalMoneyExpr(str(fd.get("amountPerMonth")));
    const scope = "STORE";
    const storeId = str(fd.get("storeId"));
    const allocation = "REVENUE";
    const startMonth = str(fd.get("startMonth"));
    const endMonth = str(fd.get("endMonth"));
    if (!amt.ok || amt.value <= 0) return { error: "Tiền thuê / tháng không hợp lệ" };
    if (!/^\d{4}-\d{2}$/.test(startMonth)) return { error: "Chọn tháng bắt đầu" };
    if (endMonth && (!/^\d{4}-\d{2}$/.test(endMonth) || endMonth < startMonth)) return { error: "Tháng kết thúc không hợp lệ" };
    const store = storeId ? await Store.findById(storeId).select("name").lean() : null;
    if (!store) return { error: "Chọn cơ sở" };
    const name = `Tiền thuê nhà ${store.name.replace(/^TBS\s*/i, "")}`;
    const customShares: never[] = [];
    // khoảng tháng không được chồng lên khoản thuê khác của cùng cơ sở
    const others = await FixedCost.find({ storeId, ...(id ? { _id: { $ne: id } } : {}) }).lean();
    const end = endMonth || "9999-12";
    const clash = others.find((o) => o.startMonth <= end && (o.endMonth || "9999-12") >= startMonth);
    if (clash)
      return { error: `Trùng thời gian với khoản thuê từ ${clash.startMonth}${clash.endMonth ? ` đến ${clash.endMonth}` : " (đang áp dụng)"} – đặt "Đến tháng" cho khoản cũ trước` };
    const doc = {
      name,
      category,
      amountPerMonth: amt.value,
      scope,
      storeId,
      allocation,
      customShares,
      startMonth,
      endMonth: endMonth || null,
      note: str(fd.get("note")) || undefined,
    };
    const actor = adminActor(admin);
    if (id) {
      const prev = await FixedCost.findById(id).lean();
      await FixedCost.updateOne({ _id: id }, { $set: doc });
      await audit(actor, "fixedCost.update", { type: "FixedCost", id }, prev, doc);
    } else {
      const c = await FixedCost.create({ ...doc, createdBy: actor.name });
      await audit(actor, "fixedCost.create", { type: "FixedCost", id: String(c._id) }, null, doc);
    }
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteFixedCost(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("finance.rent");
    await connectDB();
    const id = str(fd.get("id"));
    const prev = await FixedCost.findById(id).lean();
    await FixedCost.deleteOne({ _id: id });
    await audit(adminActor(admin), "fixedCost.delete", { type: "FixedCost", id }, prev, null);
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Cài đặt tài chính (Admin Tổng): nhóm Telegram, bật/tắt báo cáo, % phí sàn từng cơ sở. */
export async function saveFinanceSettings(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("finance.settings");
    await connectDB();
    const set = {
      financeChatId: str(fd.get("financeChatId")),
      financeReportDaily: fd.get("financeReportDaily") === "on",
      financeReportWeekly: fd.get("financeReportWeekly") === "on",
      financeReportMonthly: fd.get("financeReportMonthly") === "on",
      financeAiComment: fd.get("financeAiComment") === "on",
    };
    if (set.financeChatId && !/^-?\d+$/.test(set.financeChatId)) return { error: "Chat ID chỉ gồm số (nhóm thường bắt đầu bằng -100…)" };
    await Settings.updateOne({ key: "main" }, { $set: set });
    for (const s of await Store.find().select("_id").lean()) {
      const g = dec(fd.get(`grab_${s._id}`), -1);
      const sh = dec(fd.get(`shopee_${s._id}`), -1);
      if (g < 0 || g > 100 || sh < 0 || sh > 100) return { error: "Phí sàn phải từ 0 đến 100%" };
      await Store.updateOne({ _id: s._id }, { $set: { grabFeePct: g, shopeeFeePct: sh } });
    }
    await audit(adminActor(admin), "finance.settings", { type: "Settings", id: "main" }, null, set);
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function testFinanceTelegram(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await assertPerm("finance.settings");
    const chat = str(fd.get("chatId")) || (await financeChatId());
    await sendTelegramText(chat, "✅ Tiệm Bơ Sầu – kết nối nhóm Quản lý doanh thu thành công.");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Gửi ngay 1 báo cáo (gửi lại kể cả đã gửi). */
export async function sendReportNow(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await assertOwner();
    const kind = str(fd.get("kind"));
    const date = str(fd.get("date"));
    if (!isYmd(date)) return { error: "Chọn ngày" };
    const st =
      kind === "weekly" ? await sendWeeklyReport(weekStartOf(date), true) : kind === "monthly" ? await sendMonthlyReport(date.slice(0, 7), true) : await sendDailyReport(date, true);
    if (st === "DISABLED") return { error: "Chưa cấu hình bot Telegram hoặc chat ID nhóm Quản lý doanh thu" };
    if (st === "FAILED") return { error: "Gửi lỗi – kiểm tra bot đã ở trong nhóm chưa" };
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Sổ quỹ: nộp tiền mặt vào tài khoản / rút tài khoản ra tiền mặt (chỉ Admin Tổng – doanh thu không đổi) ===== */
export async function saveCashTransfer(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertOwner();
    await connectDB();
    const { CashTransfer } = await import("@/lib/models");
    const storeId = str(fd.get("storeId"));
    const date = str(fd.get("date"));
    const k = CASH_KINDS.find((x) => x.value === str(fd.get("kind")));
    const amt = evalMoneyExpr(str(fd.get("amount")));
    if (storeId && !(isValidObjectId(storeId) && (await Store.exists({ _id: storeId })))) return { error: "Chọn cơ sở" };
    if (!isYmd(date)) return { error: "Chọn ngày" };
    if (!k) return { error: "Chọn loại phiếu" };
    if ((k.kind === "DEPOSIT" || k.kind === "WITHDRAW") && !storeId) return { error: "Nộp / rút giữa TM và TK cần chọn cơ sở" };
    if (!amt.ok || amt.value <= 0) return { error: "Số tiền không hợp lệ" };
    const doc = {
      ...(storeId ? { storeId } : {}),
      date,
      month: date.slice(0, 7),
      kind: k.kind,
      ...(k.account ? { account: k.account } : {}),
      amount: Math.round(amt.value),
      note: str(fd.get("note")).slice(0, 200),
      createdBy: adminActor(admin).name,
    };
    const c = await CashTransfer.create(doc);
    await audit(adminActor(admin), "cash.transfer.create", { type: "CashTransfer", id: String(c._id) }, null, doc);
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteCashTransfer(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertOwner();
    await connectDB();
    const { CashTransfer } = await import("@/lib/models");
    const c = await CashTransfer.findById(str(fd.get("id"))).lean();
    if (!c) return { error: "Không tìm thấy phiếu" };
    await CashTransfer.deleteOne({ _id: c._id });
    await audit(adminActor(admin), "cash.transfer.delete", { type: "CashTransfer", id: String(c._id) }, c, null);
    revalidatePath("/admin/finance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
