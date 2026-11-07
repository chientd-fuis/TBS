/* Gửi ảnh chốt ca vào nhóm Telegram qua Bot API (https://core.telegram.org/bots/api). */

const API = "https://api.telegram.org";

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

type TgResult = { ok: boolean; description?: string; result?: unknown };

/**
 * Gửi 1 ảnh (sendPhoto) hoặc nhiều ảnh dạng album (sendMediaGroup, tối đa 10).
 * Caption gắn vào ảnh đầu tiên. Trả về danh sách message_id.
 */
export async function sendPhotosToTelegram(chatId: string, photos: Buffer[], caption: string): Promise<number[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Chưa cấu hình nhóm Telegram (TELEGRAM_CHAT_ID hoặc Telegram chat ID của cơ sở)");
  if (!photos.length) throw new Error("Không có ảnh");
  const fd = new FormData();
  fd.append("chat_id", chatId);
  let method: string;
  if (photos.length === 1) {
    method = "sendPhoto";
    fd.append("photo", new Blob([new Uint8Array(photos[0])], { type: "image/jpeg" }), "chot-ca.jpg");
    fd.append("caption", caption.slice(0, 1024));
  } else {
    method = "sendMediaGroup";
    const media = photos.slice(0, 10).map((_, i) => ({
      type: "photo",
      media: `attach://p${i}`,
      ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}),
    }));
    fd.append("media", JSON.stringify(media));
    photos.slice(0, 10).forEach((p, i) => fd.append(`p${i}`, new Blob([new Uint8Array(p)], { type: "image/jpeg" }), `chot-ca-${i + 1}.jpg`));
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const r = await fetch(`${API}/bot${token}/${method}`, { method: "POST", body: fd, signal: ctrl.signal });
    const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
    if (!j.ok) throw new Error(`Telegram: ${j.description || r.status}`);
    const res = j.result as { message_id: number } | { message_id: number }[];
    return Array.isArray(res) ? res.map((m) => m.message_id) : [res.message_id];
  } finally {
    clearTimeout(t);
  }
}

/** Gửi tin nhắn chữ – dùng cho nút "Gửi thử" ở màn hình cơ sở. */
/** Gửi tin nhắn chữ. Trả về message_id. */
export async function sendTelegramText(chatId: string, text: string): Promise<number> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Chưa có Telegram chat ID");
  const r = await fetch(`${API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
  if (!j.ok) throw new Error(`Telegram: ${j.description || r.status}`);
  const res = (j as { result?: { message_id?: number } }).result;
  return res?.message_id ?? 0;
}
