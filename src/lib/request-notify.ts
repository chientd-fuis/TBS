import { after } from "next/server";
import { getSettings } from "./settings";
import { Store } from "./models";
import { attendanceChatId } from "./attendance-notify";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { responsibleAdminNames } from "./admin-stores";

/**
 * NHÓM YÊU CẦU (Telegram): mọi yêu cầu chờ admin xác nhận gửi về 1 nhóm chung, KHÔNG gửi nhóm chấm công nữa:
 * sửa giờ / chấm bù, làm ngoài giờ, thử việc, đăng ký tài khoản mới, đổi thiết bị, nhờ làm hộ / đổi ca, đăng ký ca, khiếu nại lương.
 * Chat ID: Cài đặt → "Nhóm Telegram nhận yêu cầu" (Admin Tổng) → env TELEGRAM_REQUEST_CHAT_ID
 * → (chưa cài) nhóm chấm công của cơ sở như trước, để không mất tin trong lúc chưa tạo nhóm.
 */
export async function requestChatId(store?: { telegramAttendanceChatId?: string | null } | null) {
  const s = await getSettings().catch(() => null);
  return s?.requestChatId || process.env.TELEGRAM_REQUEST_CHAT_ID || attendanceChatId(store ?? {});
}

/** Các loại yêu cầu báo nhóm – Cài đặt → Nhóm Telegram nhận yêu cầu: bật / tắt từng loại (mặc định bật hết) */
export const REQUEST_KINDS = [
  { key: "register", label: "🙋 Đăng ký nhân viên mới" },
  { key: "device", label: "📱 Đổi / thêm thiết bị chấm công" },
  { key: "adjustment", label: "✏️ Sửa giờ chấm công / chấm bù ca" },
  { key: "overtime", label: "⏱ Làm ngoài giờ / ngoài ca" },
  { key: "probation", label: "🟣 Thử việc (hết 3 ca / hết tháng)" },
  { key: "cover", label: "🤝 Nhờ làm hộ / đổi ca" },
  { key: "shiftReg", label: "🗓 Đăng ký ca" },
  { key: "payrollFeedback", label: "💬 Khiếu nại bảng lương" },
  { key: "revenueGap", label: "💸 Bù doanh thu (thiếu tiền)" },
] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number]["key"];

/** Loại yêu cầu này có đang bật báo Telegram không (mặc định bật) */
export async function requestKindOn(kind: RequestKind) {
  const s = await getSettings().catch(() => null);
  return !(s?.requestNotifyOff as string[] | undefined)?.includes(kind);
}

export const storeShort = (name?: string | null) => (name ?? "").replace(/^TBS\s+/i, "");

/** Gửi 1 tin yêu cầu vào nhóm yêu cầu. Không ném lỗi. */
export async function sendRequestNotice(storeId: unknown, text: string, kind: RequestKind) {
  try {
    if (!telegramConfigured() || !(await requestKindOn(kind))) return;
    const store = storeId ? await Store.findById(storeId).select("telegramAttendanceChatId").lean() : null;
    const chat = await requestChatId(store);
    if (chat) await sendTelegramText(chat, text.slice(0, 4000));
  } catch (e) {
    console.error("[request notify]", (e as Error).message);
  }
}

/**
 * Gửi sau khi đã trả kết quả cho người dùng (không làm chậm thao tác). lines: nội dung; perm: quyền duyệt
 * → thêm dòng "Cần admin … xác nhận" (admin phụ trách cơ sở có quyền đó – lib/admin-stores.ts).
 */
export function queueRequestNotice(storeId: unknown, lines: string[], opts: { kind: RequestKind; perm?: string | null; where: string }) {
  after(async () => {
    if (!(await requestKindOn(opts.kind))) return;
    const admins = await responsibleAdminNames(storeId, opts.perm ?? null).catch(() => [] as string[]);
    const who = admins.length ? `admin ${admins.join(", ")}` : "admin";
    await sendRequestNotice(storeId, [...lines, `👉 Cần ${who} xác nhận: vào ${opts.where}.`].join("\n"), opts.kind);
  });
}

/** Như queueRequestNotice nhưng gửi ngay (dùng được cả ngoài 1 request – VD cron tính lại doanh thu ngày). */
export async function queueOrSendRequest(storeId: unknown, lines: string[], opts: { kind: RequestKind; perm?: string | null; where: string }) {
  if (!(await requestKindOn(opts.kind))) return;
  const admins = await responsibleAdminNames(storeId, opts.perm ?? null).catch(() => [] as string[]);
  const who = admins.length ? `admin ${admins.join(", ")}` : "admin";
  await sendRequestNotice(storeId, [...lines, `👉 Cần ${who} xác nhận: vào ${opts.where}.`].join("\n"), opts.kind);
}
