/* Gửi ảnh chốt ca vào nhóm Telegram qua Bot API (https://core.telegram.org/bots/api). */

const API = "https://api.telegram.org";

export function telegramConfigured() {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

type TgResult = { ok: boolean; description?: string; result?: unknown; error_code?: number; parameters?: { retry_after?: number } };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Gọi Bot API, tự thử lại khi Telegram trục trặc tạm thời:
 *   - 502 Bad Gateway / 5xx / mất mạng / quá giờ → thử lại sau 1,5 s rồi 4 s
 *   - 429 Too Many Requests (gửi quá nhanh) → chờ đúng retry_after Telegram báo (tối đa 10 s)
 * Lỗi khác (sai chat ID, bot bị kick…) → báo luôn, không thử lại.
 */
async function tgCall(method: string, body: () => { body: BodyInit; headers?: Record<string, string> }, timeoutMs = 30_000): Promise<TgResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN");
  const delays = [1500, 4000];
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let j: TgResult;
    let status = 0;
    try {
      const b = body();
      const r = await fetch(`${API}/bot${token}/${method}`, { method: "POST", ...b, signal: ctrl.signal });
      status = r.status;
      j = (await r.json().catch(() => ({ ok: false, description: `HTTP ${r.status}` }))) as TgResult;
    } catch (e) {
      j = { ok: false, description: (e as Error).name === "AbortError" ? "quá giờ" : (e as Error).message };
    } finally {
      clearTimeout(t);
    }
    if (j.ok) return j;
    const code = j.error_code ?? status;
    const transient = code === 0 || code === 429 || code >= 500;
    if (!transient || attempt >= delays.length) {
      const msg = `Telegram: ${j.description || code}`;
      try {
        const { logError } = await import("./error-log");
        logError({ level: "error", source: "system", area: "Gửi Telegram", fn: method, message: transient ? `${msg} (đã thử ${attempt + 1} lần)` : msg });
      } catch {
        /* không chặn luồng chính */
      }
      throw new Error(msg);
    }
    await wait(code === 429 ? Math.min(10, j.parameters?.retry_after ?? 3) * 1000 : delays[attempt]);
  }
}

/**
 * Gửi 1 ảnh (sendPhoto) hoặc nhiều ảnh dạng album (sendMediaGroup, tối đa 10).
 * Caption gắn vào ảnh đầu tiên. Trả về danh sách message_id.
 */
export async function sendPhotosToTelegram(chatId: string, photos: Buffer[], caption: string): Promise<number[]> {
  if (!telegramConfigured()) throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Chưa cấu hình nhóm Telegram (TELEGRAM_CHAT_ID hoặc Telegram chat ID của cơ sở)");
  if (!photos.length) throw new Error("Không có ảnh");
  const method = photos.length === 1 ? "sendPhoto" : "sendMediaGroup";
  const build = () => {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    if (photos.length === 1) {
      fd.append("photo", new Blob([new Uint8Array(photos[0])], { type: "image/jpeg" }), "chot-ca.jpg");
      fd.append("caption", caption.slice(0, 1024));
    } else {
      const media = photos.slice(0, 10).map((_, i) => ({
        type: "photo",
        media: `attach://p${i}`,
        ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}),
      }));
      fd.append("media", JSON.stringify(media));
      photos.slice(0, 10).forEach((p, i) => fd.append(`p${i}`, new Blob([new Uint8Array(p)], { type: "image/jpeg" }), `chot-ca-${i + 1}.jpg`));
    }
    return { body: fd };
  };
  const j = await tgCall(method, build);
  const res = j.result as { message_id: number } | { message_id: number }[];
  return Array.isArray(res) ? res.map((m) => m.message_id) : [res.message_id];
}

/** Gửi tin nhắn chữ – dùng cho nút "Gửi thử" ở màn hình cơ sở. */
/** Gửi tin nhắn chữ. Trả về message_id. */
export async function sendTelegramText(chatId: string, text: string): Promise<number> {
  if (!telegramConfigured()) throw new Error("Chưa cấu hình TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Chưa có Telegram chat ID");
  const j = await tgCall("sendMessage", () => ({ headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text }) }), 15_000);
  const res = (j as { result?: { message_id?: number } }).result;
  return res?.message_id ?? 0;
}
