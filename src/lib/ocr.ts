import { normalizeOcr, type Revenue } from "./revenue";

/*
 * Đọc số liệu từ ảnh chốt ca bằng BOT PHÂN TÍCH CÓ SẴN của quán (qua HTTP).
 * Hợp đồng:
 *   POST  CLOSING_OCR_URL
 *   Header: Authorization: Bearer <CLOSING_OCR_SECRET>   (nếu đặt)
 *   Body:  { type: "closing_ocr", store: {code,name}, workDate, shift: {name,start,end}, employee, photos: ["data:image/jpeg;base64,..."] }
 *   Trả về JSON, VD: { "dt": 7060000, "tk": 5660000, "tm": 1328000, "cp": 72000, "shopee": 0, "note": "..." }
 *   (chấp nhận tên trường tiếng Việt: "Doanh thu", "Tài khoản", "Tiền mặt", "CP trong két", "Shopee"; số dạng "7.060.000 đ")
 */

export const ocrConfigured = () => !!process.env.CLOSING_OCR_URL;

export async function readClosingPhotos(
  photos: string[],
  ctx: { store: { code?: string; name?: string }; workDate: string; shift?: { name?: string; start?: string; end?: string } | null; employee?: string },
): Promise<{ values: Partial<Revenue>; note?: string }> {
  const url = process.env.CLOSING_OCR_URL;
  if (!url) throw new Error("Chưa cấu hình bot đọc ảnh (CLOSING_OCR_URL)");
  const secret = process.env.CLOSING_OCR_SECRET || process.env.CLOSING_WEBHOOK_SECRET;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
      body: JSON.stringify({ type: "closing_ocr", ...ctx, photos }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`Bot đọc ảnh trả lỗi HTTP ${r.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error("Bot đọc ảnh không trả về JSON");
    }
    const out = normalizeOcr(json);
    if (!Object.keys(out.values).length) throw new Error("Bot không đọc được số liệu nào từ ảnh");
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Bot đọc ảnh quá lâu không phản hồi");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
