import { connectDB } from "./db";
import { readPhoto } from "./drive";
import { ShiftClosing, Store, User } from "./models";
import { sendPhotosToTelegram, telegramConfigured } from "./telegram";
import { localTime, viDate, weekdayVi } from "./time";

/* Chốt ca: gửi ảnh vào nhóm Telegram (+ tuỳ chọn gọi webhook phân tích ảnh). */

function hashtag(s: string) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export type CaptionData = {
  storeName: string;
  storeCode: string;
  tz: string;
  workDate: string;
  createdAt: Date;
  shiftName?: string | null;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  shiftLabel?: string | null;
  employeeName: string;
  employeePhone?: string | null;
  checkInAt?: Date | null;
  checkOutAt?: Date | null;
  coworkers?: string[];
  note?: string | null;
  supportFrom?: string;
  revenue?: { dt?: number | null; tm?: number | null; tk?: number | null; cp?: number | null; grab?: number | null; shopee?: number | null } | null;
  revenueInput?: { cp?: string | null } | null;
};

/** Nội dung tin nhắn Telegram của 1 lượt chốt ca (thuần – có unit test). */
const money = (n?: number | null) => `${Math.round(n ?? 0).toLocaleString("vi-VN")}đ`;
function revenueLines(r: CaptionData["revenue"], input?: CaptionData["revenueInput"]) {
  if (!r || r.dt == null) return [];
  const diff = (r.dt ?? 0) - ((r.tm ?? 0) + (r.tk ?? 0) + (r.cp ?? 0) + (r.grab ?? 0) + (r.shopee ?? 0));
  const tcDetail = input?.cp && /[a-zA-ZÀ-ỹ+]/.test(input.cp) ? ` (${input.cp.trim()})` : "";
  return [
    `💰 Doanh thu máy: ${money(r.dt)}`,
    `   Tiền mặt ${money(r.tm)} · Tài khoản ${money(r.tk)}`,
    `   Thu chi ${money(r.cp)}${tcDetail}`,
    `   Grab ${money(r.grab)} · Shopee ${money(r.shopee)}`,
    `${diff === 0 ? "✅" : "⚠️"} Âm/Dương: ${diff > 0 ? "+" : ""}${money(diff)}`,
  ];
}

export function formatCaption(d: CaptionData) {
  const hhmm = (x?: Date | null) => (x ? localTime(new Date(x), d.tz).slice(0, 5) : "");
  const endAt = d.checkOutAt ? new Date(d.checkOutAt) : d.createdAt;
  const worked = d.checkInAt ? Math.max(0, (endAt.getTime() - new Date(d.checkInAt).getTime()) / 3600000).toFixed(1).replace(".", ",") : "";
  const shiftLine = d.shiftName
    ? `⏰ Ca ${d.shiftName} (${d.shiftStart}–${d.shiftEnd})`
    : d.shiftLabel
      ? `⏰ Ca ${d.shiftLabel}`
      : "⏰ Ngoài ca (không có ca được xếp)";
  return [
    `🧾 CHỐT CA`,
    `📅 Ngày: ${viDate(d.workDate).slice(0, 5)} (${weekdayVi(d.workDate)})`,
    `🏪 Cơ sở: ${d.storeName.replace(/^TBS\s+/i, "")}`,
    `👤 Thu ngân: ${d.employeeName}${d.employeePhone ? ` · ${d.employeePhone}` : ""}${d.supportFrom ? ` (hỗ trợ từ ${d.supportFrom})` : ""}`,
    shiftLine,
    d.checkInAt
      ? `🕐 Vào ca ${hhmm(d.checkInAt)}${d.checkOutAt ? ` · Ra ca ${hhmm(d.checkOutAt)}` : ""} · Chốt lúc ${hhmm(d.createdAt)} (${worked}h)`
      : `🕐 Chốt lúc ${hhmm(d.createdAt)} (chưa có lượt check-in)`,
    d.coworkers?.length ? `👥 Cùng ca: ${d.coworkers.join(", ")}` : "",
    ...revenueLines(d.revenue, d.revenueInput),
    d.note ? `📝 ${d.note}` : "",
    `#chotca #${hashtag(d.storeCode || "TBS")}${d.shiftName ? ` #ca_${hashtag(d.shiftName)}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildCaption(closingId: string) {
  const c = await ShiftClosing.findById(closingId).lean();
  if (!c) throw new Error("Không tìm thấy lượt chốt ca");
  const [store, user] = await Promise.all([Store.findById(c.storeId).lean(), User.findById(c.userId).lean()]);
  return formatCaption({
    storeName: store?.name ?? "",
    storeCode: store?.code ?? "TBS",
    tz: store?.timezone || "Asia/Ho_Chi_Minh",
    workDate: c.workDate,
    createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
    shiftName: c.shiftName,
    shiftStart: c.shiftStart,
    shiftEnd: c.shiftEnd,
    shiftLabel: c.shiftLabel,
    employeeName: c.employeeName || user?.name || user?.email || "",
    employeePhone: c.employeePhone || user?.phone,
    checkInAt: c.checkInAt,
    checkOutAt: c.checkOutAt,
    coworkers: c.coworkers,
    note: c.note,
    revenue: c.revenue,
    revenueInput: c.revenueInput,
    supportFrom: user?.storeId && String(user.storeId) !== String(c.storeId) ? ((await Store.findById(user.storeId).select("name").lean())?.name ?? undefined) : undefined,
  });
}

/** Gửi (hoặc gửi lại) 1 lượt chốt ca lên Telegram. Không ném lỗi – ghi trạng thái vào DB. */
export async function deliverClosing(closingId: string, photoBufs?: Buffer[]) {
  await connectDB();
  const c = await ShiftClosing.findById(closingId);
  if (!c) return;
  const store = await Store.findById(c.storeId).lean();
  const chatId = store?.telegramChatId || process.env.TELEGRAM_CHAT_ID || "";

  // ảnh: dùng bản trong bộ nhớ (vừa chụp) hoặc đọc lại từ Drive / ảnh tạm
  let bufs = photoBufs;
  if (!bufs) {
    bufs = [];
    for (const p of c.photos) {
      const b = await readPhoto({ driveId: p.driveId, pendingId: p.pendingId ? String(p.pendingId) : undefined }).catch(() => null);
      if (b) bufs.push(b);
    }
  }

  // 1) Telegram
  if (!telegramConfigured() || !chatId) {
    c.set("telegram", { ...c.toObject().telegram, status: "DISABLED", error: !telegramConfigured() ? "Chưa cấu hình TELEGRAM_BOT_TOKEN" : "Chưa có Telegram chat ID", chatId });
  } else {
    try {
      const ids = await sendPhotosToTelegram(chatId, bufs, await buildCaption(closingId));
      c.set("telegram", { status: "SENT", chatId, messageIds: ids, error: "", attempts: (c.telegram?.attempts ?? 0) + 1, sentAt: new Date() });
    } catch (e) {
      c.set("telegram", { ...c.toObject().telegram, status: "FAILED", chatId, error: (e as Error).message.slice(0, 300), attempts: (c.telegram?.attempts ?? 0) + 1 });
    }
  }

  // 2) Webhook phân tích ảnh (tuỳ chọn) – dùng khi bot phân tích không đọc được tin nhắn của bot khác
  const hook = process.env.CLOSING_WEBHOOK_URL;
  if (hook && c.webhook?.status !== "SENT") {
    try {
      const [user] = await Promise.all([User.findById(c.userId).select("name email").lean()]);
      const r = await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json", ...(process.env.CLOSING_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.CLOSING_WEBHOOK_SECRET}` } : {}) },
        body: JSON.stringify({
          type: "shift_closing",
          id: String(c._id),
          store: { code: store?.code, name: store?.name },
          employee: { name: c.employeeName || user?.name, email: user?.email, phone: c.employeePhone },
          workDate: c.workDate,
          shift: { label: c.shiftLabel, name: c.shiftName, start: c.shiftStart, end: c.shiftEnd, checkInAt: c.checkInAt, checkOutAt: c.checkOutAt, coworkers: c.coworkers },
          caption: await buildCaption(String(c._id)),
          note: c.note,
          revenue: c.revenue,
          createdAt: c.createdAt,
          telegram: { chatId, messageIds: c.telegram?.messageIds ?? [] },
          photos: bufs.map((b) => `data:image/jpeg;base64,${b.toString("base64")}`),
        }),
      });
      c.set("webhook", { status: r.ok ? "SENT" : "FAILED", error: r.ok ? "" : `HTTP ${r.status}` });
    } catch (e) {
      c.set("webhook", { status: "FAILED", error: (e as Error).message.slice(0, 300) });
    }
  }
  await c.save();
  return c.telegram?.status;
}

/** Cron: gửi lại các lượt chốt ca gửi Telegram lỗi (tối đa 10 lần). */
export async function retryFailedClosings(limit = 20) {
  await connectDB();
  const list = await ShiftClosing.find({
    "telegram.attempts": { $lt: 10 },
    $or: [{ "telegram.status": "FAILED" }, { "telegram.status": "PENDING", createdAt: { $lt: new Date(Date.now() - 10 * 60_000) } }],
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select("_id")
    .lean();
  let ok = 0;
  for (const c of list) if ((await deliverClosing(String(c._id))) === "SENT") ok++;
  return ok;
}
