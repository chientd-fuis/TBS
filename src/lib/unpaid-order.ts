import { Types } from "mongoose";
import { connectDB } from "./db";
import { BonusPenalty, RevenueGap, ShiftClosing, Store, User, UnpaidOrder } from "./models";
import { fold, UNPAID } from "./revenue-gap";
import { parseMoney } from "./revenue";
import { viDate, weekdayVi } from "./time";

/*
 * ĐƠN CHƯA THANH TOÁN – nhân viên ghi ở chốt ca: "25k Chưa TT", "chưa thanh toán 25k", "chưa TT 255", "khách nợ 30k"…
 *  1) Lúc chốt ca (và mỗi lần số chốt ca tính lại): tạo CẢNH BÁO cho admin – "Ca X có đơn chưa thanh toán, xác nhận khách đã chuyển chưa".
 *  2) Quá 2 ngày chưa xác nhận → thành YÊU CẦU PHẠT bù doanh thu (đơn không đòi được khách) chờ admin duyệt.
 * Đọc ở: ghi chú ca + ô thu chi (nhân viên hay ghi vào đó).
 */

export const ESCALATE_MS = 2 * 86_400_000; // quá 2 ngày → yêu cầu phạt

type Id = string | Types.ObjectId;

/** Tìm các đoạn ghi chú nói đơn chưa thanh toán + số tiền (số không đơn vị < 1000 hiểu là nghìn: "255" = 255.000). */
export function parseUnpaid(text: string): { amount: number; quote: string }[] {
  if (!text?.trim()) return [];
  const out: { amount: number; quote: string }[] = [];
  // tách theo ; xuống dòng | + và dấu phẩy không phải phân tách hàng nghìn
  for (const seg of text.split(/[;\n|+]|,(?!\d{3}\b)/)) {
    const f = fold(seg);
    if (!UNPAID.test(f)) continue;
    // nhiều số ("1 đơn 25k") → ưu tiên số có đơn vị (k / nghìn / tr / đ), không có thì lấy số lớn nhất
    const nums = [...f.matchAll(/(\d[\d.,]*)\s*(k\b|nghin|ngan|tr\d{0,3}|d\b)?/g)].map((m) => {
      const unit = (m[2] ?? "").replace(/nghin|ngan/, "k").replace(/^d$/, "");
      let v = parseMoney(m[1].replace(/[.,]$/, "") + unit) ?? 0;
      if (!unit && v < 10) v = 0; // "bàn 3", "2 đơn" – không phải tiền
      if (!unit && v > 0 && v < 1000) v *= 1000;
      return { v, unit: !!m[2] };
    });
    const withUnit = nums.filter((x) => x.unit && x.v > 0);
    const amount = (withUnit.length ? withUnit : nums).reduce((mx, x) => Math.max(mx, x.v), 0);
    out.push({ amount, quote: seg.trim().slice(0, 120) });
  }
  return out;
}

/** Đọc lại các lượt chốt ca của 1 ngày → tạo / cập nhật / gỡ cảnh báo đơn chưa thanh toán. Không ném lỗi. */
export async function syncUnpaidOrders(storeId: Id, date: string) {
  try {
    await connectDB();
    const list = await ShiftClosing.find({ storeId, workDate: date }).select("note revenueInput shiftName employeeName userId").lean();
    const found = new Map<string, { c: (typeof list)[number]; items: { amount: number; quote: string }[] }>();
    for (const c of list) {
      const items = [...parseUnpaid(c.note ?? ""), ...parseUnpaid(c.revenueInput?.cp ?? "")];
      if (items.length) found.set(String(c._id), { c, items });
    }
    const cur = await UnpaidOrder.find({ storeId, date }).lean();
    // ghi chú đã sửa / ca đã xoá → gỡ cảnh báo còn mở
    for (const u of cur) if (!found.has(String(u.closingId)) && ["OPEN", "ESCALATED"].includes(u.status)) await UnpaidOrder.deleteOne({ _id: u._id });
    const names = new Map(
      (await User.find({ _id: { $in: [...found.values()].map((x) => x.c.userId).filter(Boolean) } }).select("name").lean()).map((u) => [String(u._id), u.name]),
    );
    for (const [cid, { c, items }] of found) {
      const old = cur.find((u) => String(u.closingId) === cid);
      const data = {
        storeId,
        date,
        shiftName: c.shiftName ?? "",
        userId: c.userId,
        name: (c.userId && names.get(String(c.userId))) || c.employeeName || "?",
        amount: items.reduce((s, x) => s + x.amount, 0),
        quotes: items.map((x) => x.quote),
      };
      if (old && !["OPEN", "ESCALATED"].includes(old.status)) continue; // admin đã xử lý → giữ nguyên
      if (old) {
        await UnpaidOrder.updateOne({ _id: old._id }, { $set: data });
        continue;
      }
      const doc = await UnpaidOrder.create({ ...data, closingId: c._id });
      await notifyUnpaid(String(doc._id), false);
    }
  } catch (e) {
    console.error("[unpaid order]", (e as Error).message);
  }
}

/** Cảnh báo quá 2 ngày chưa xác nhận → yêu cầu phạt bù doanh thu (cron hằng ngày + khi admin mở trang Yêu cầu). */
export async function escalateUnpaid(now = new Date()) {
  await connectDB();
  const due = await UnpaidOrder.find({ status: "OPEN", detectedAt: { $lte: new Date(now.getTime() - ESCALATE_MS) } }).select("_id").lean();
  let n = 0;
  for (const d of due) {
    const r = await UnpaidOrder.updateOne({ _id: d._id, status: "OPEN" }, { $set: { status: "ESCALATED", escalatedAt: now } });
    if (r.modifiedCount) {
      n++;
      await notifyUnpaid(String(d._id), true);
    }
  }
  return n;
}

const money = (n?: number | null) => (n ? `${Math.round(n).toLocaleString("vi-VN")} đ` : "chưa rõ số tiền");

export function unpaidLines(u: { date: string; shiftName?: string | null; name?: string | null; amount?: number | null; quotes?: string[] }, storeName: string, escalated: boolean) {
  return [
    escalated ? "⏰ ĐƠN CHƯA THANH TOÁN QUÁ 2 NGÀY → YÊU CẦU PHẠT BÙ DOANH THU" : "🧾 CA CÓ ĐƠN CHƯA THANH TOÁN",
    `🏪 Cơ sở: ${storeName.replace(/^TBS\s+/i, "")}`,
    `📅 ${viDate(u.date).slice(0, 5)} (${weekdayVi(u.date)}) · Ca ${u.shiftName || "?"} – ${u.name || "?"}`,
    `💰 ${money(u.amount)}`,
    ...(u.quotes ?? []).map((q) => `📝 “${q}”`),
    escalated ? "Khách chưa trả, không đòi được → duyệt phạt người chốt ca, hoặc bấm “Khách đã trả” nếu đã nhận tiền." : "Cần xác nhận khách đã chuyển chưa (quá 2 ngày chưa xác nhận sẽ thành yêu cầu phạt).",
  ];
}

async function notifyUnpaid(id: string, escalated: boolean) {
  try {
    const u = await UnpaidOrder.findById(id).lean();
    if (!u) return;
    const store = await Store.findById(u.storeId).select("name").lean();
    const { queueOrSendRequest } = await import("./request-notify");
    await queueOrSendRequest(u.storeId, unpaidLines(u, store?.name ?? "", escalated), {
      kind: "unpaid",
      perm: "revenue",
      where: escalated ? "Yêu cầu → Đơn chưa thanh toán để Duyệt phạt / Không phạt / Khách đã trả" : "Yêu cầu → Đơn chưa thanh toán để bấm Khách đã trả",
    });
  } catch (e) {
    console.error("[unpaid notify]", (e as Error).message);
  }
}

/**
 * Admin xử lý: paid = khách đã trả · dismiss = không phải đơn nợ (chỉ khi còn cảnh báo) ·
 * penalize = ghi phạt người chốt ca (số admin chốt) · waive = không phạt.
 */
export async function resolveUnpaid(id: string, op: "paid" | "dismiss" | "penalize" | "waive", by: string, reply: string, amount?: number) {
  await connectDB();
  const u = await UnpaidOrder.findOne({ _id: id, status: { $in: ["OPEN", "ESCALATED"] } }).lean();
  if (!u) throw new Error("Đơn này đã được xử lý");
  const done = { decidedBy: by, decidedAt: new Date(), reply };
  if (op === "paid" || op === "dismiss" || op === "waive") {
    const status = op === "paid" ? "PAID" : op === "dismiss" ? "DISMISSED" : "WAIVED";
    await UnpaidOrder.updateOne({ _id: u._id, status: u.status }, { $set: { status, ...done } });
    return 0;
  }
  if (!u.userId) throw new Error("Ca này không rõ người chốt – không ghi phạt được (bấm Không phạt rồi ghi phạt tay ở Thưởng / Phạt)");
  const amt = Math.max(0, Math.round(amount ?? u.amount ?? 0));
  if (!amt) throw new Error("Nhập số tiền phạt");
  const dm = `${u.date.slice(8)}/${u.date.slice(5, 7)}`;
  await BonusPenalty.updateOne(
    { autoKey: `unpaid:${u._id}` },
    {
      $set: {
        userId: u.userId,
        storeId: u.storeId,
        kind: "PENALTY",
        date: u.date,
        month: u.date.slice(0, 7),
        amountVnd: amt,
        content: `Bù doanh thu – đơn chưa thanh toán không đòi được ${dm} (ca ${u.shiftName})${reply ? ` – ${reply}` : ""}`.slice(0, 300),
        createdBy: by,
        autoEdited: true,
      },
    },
    { upsert: true },
  );
  await UnpaidOrder.updateOne({ _id: u._id }, { $set: { status: "PENALIZED", penalty: amt, ...done } });
  return amt;
}

/** Bù doanh thu (thiếu tiền) cùng ngày – để admin không phạt 2 lần cho cùng 1 khoản. */
export async function sameDayGaps(list: { storeId: unknown; date: string }[]) {
  if (!list.length) return new Map<string, { status: string; total: number }>();
  const gaps = await RevenueGap.find({ $or: list.map((x) => ({ storeId: x.storeId, date: x.date })) }).select("storeId date status total").lean();
  return new Map(gaps.map((g) => [`${g.storeId}|${g.date}`, { status: g.status, total: g.total ?? 0 }]));
}
