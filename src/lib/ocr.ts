import { normalizeOcr, type Revenue } from "./revenue";

/*
 * Đọc số liệu từ ảnh chốt ca.
 * - Mặc định: Google Gemini (GEMINI_API_KEY, tuỳ chọn GEMINI_MODEL – mặc định gemini-2.5-flash)
 * - Dự phòng: bot riêng qua HTTP (CLOSING_OCR_URL / CLOSING_OCR_SECRET)
 */

export type OcrResult = { values: Partial<Revenue>; note?: string; date?: string; cpDetail?: string; provider: string };

export const ocrConfigured = () => !!process.env.GEMINI_API_KEY || !!process.env.CLOSING_OCR_URL;

const GEMINI_PROMPT = `Bạn đọc ẢNH CHỐT CA của quán cà phê / trà sữa "Tiệm Bơ Sầu" (Việt Nam). Ảnh có thể là phiếu in từ máy bán hàng (POS), màn hình báo cáo doanh thu, hoặc tờ giấy ghi tay.
Hãy trích các số liệu (đơn vị VND, trả về SỐ NGUYÊN, không dấu chấm phẩy):
- dt: Doanh thu / tổng doanh thu máy / tổng tiền bán (tổng cộng của ca)
- tm: Tiền mặt (cash)
- tk: Tài khoản / chuyển khoản / QR / banking / thẻ
- cp: Tổng thu chi / chi phí / chi trong két (nếu có nhiều khoản thì cộng lại)
- cp_detail: chi tiết các khoản thu chi như ghi trên ảnh, dạng "30k sữa chua + 20k ship" (bỏ trống nếu không có)
- grab: tiền đơn Grab / GrabFood
- shopee: tiền đơn Shopee / ShopeeFood
- date: ngày ghi trên ảnh, dạng YYYY-MM-DD (bỏ trống nếu không thấy)
- note: ghi chú khác đáng chú ý (ngắn gọn, tiếng Việt)
Quy tắc: KHÔNG đoán. Không thấy rõ thì để null. Hiểu "k" = nghìn, "tr" = triệu. Chỉ trả về JSON.`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    dt: { type: "INTEGER", nullable: true },
    tm: { type: "INTEGER", nullable: true },
    tk: { type: "INTEGER", nullable: true },
    cp: { type: "INTEGER", nullable: true },
    cp_detail: { type: "STRING", nullable: true },
    grab: { type: "INTEGER", nullable: true },
    shopee: { type: "INTEGER", nullable: true },
    date: { type: "STRING", nullable: true },
    note: { type: "STRING", nullable: true },
  },
};

/** Lấy JSON từ phản hồi Gemini (candidates[0].content.parts[*].text). */
export function parseGeminiResponse(body: unknown): unknown {
  const b = body as { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };
  if (b.promptFeedback?.blockReason) throw new Error(`Gemini từ chối ảnh (${b.promptFeedback.blockReason})`);
  const text = (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
  if (!text) throw new Error("Gemini không trả về nội dung");
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Gemini trả về dữ liệu không đúng định dạng");
  }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>, slowMsg: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(slowMsg);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const geminiConfigured = () => !!process.env.GEMINI_API_KEY;

/**
 * Gọi Gemini (generateContent). photos = data URL ảnh. schema có → trả JSON đã parse, không có → trả text.
 */
export async function geminiGenerate(opts: { prompt: string; photos?: string[]; schema?: object; timeoutMs?: number; temperature?: number }): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Chưa cấu hình GEMINI_API_KEY");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const parts: unknown[] = [{ text: opts.prompt }];
  for (const p of opts.photos ?? []) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(p);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const body = await withTimeout(
    opts.timeoutMs ?? 45_000,
    async (signal) => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: opts.temperature ?? 0,
            ...(opts.schema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
          },
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg = (j as { error?: { message?: string; status?: string } }).error;
        if (r.status === 429) throw new Error("Gemini đang quá tải / hết lượt miễn phí – thử lại sau ít phút hoặc nhập tay");
        if (r.status === 400 && /API key/i.test(msg?.message ?? "")) throw new Error("GEMINI_API_KEY không hợp lệ");
        throw new Error(`Gemini lỗi HTTP ${r.status}${msg?.message ? `: ${msg.message.slice(0, 150)}` : ""}`);
      }
      return j;
    },
    "Gemini đọc ảnh quá lâu – thử lại hoặc nhập tay",
  );
  if (opts.schema) return parseGeminiResponse(body);
  const b = body as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  return (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
}

async function readWithGemini(photos: string[], refDate: string): Promise<OcrResult> {
  const json = await geminiGenerate({ prompt: GEMINI_PROMPT, photos, schema: SCHEMA });
  return { ...normalizeOcr(json, refDate), provider: "gemini" };
}

/* ---------- Bill chi phí ---------- */
const BILL_PROMPT = `Bạn đọc ẢNH HOÁ ĐƠN / BILL THANH TOÁN chi phí của quán trà sữa ở Việt Nam (hoá đơn siêu thị, chợ, phiếu giao hàng, biên lai chuyển khoản, hoá đơn điện nước, giấy viết tay…).
Trích (đơn vị VND, số nguyên):
- amount: TỔNG SỐ TIỀN phải trả / đã thanh toán (không phải tiền khách đưa, không phải tiền thối lại)
- date: ngày trên bill, dạng YYYY-MM-DD
- vendor: tên nơi bán / người nhận tiền
- items: tóm tắt các món chính, ngắn gọn (VD "Sữa đặc x5, đường 2kg")
- category: một trong {CATS}
Quy tắc: KHÔNG đoán. Không thấy rõ thì để null. "k" = nghìn, "tr" = triệu. Chỉ trả về JSON.`;

export async function readBillPhoto(photo: string, refDate: string, categories: string[]) {
  const json = await geminiGenerate({
    prompt: BILL_PROMPT.replace("{CATS}", categories.join(", ")),
    photos: [photo],
    schema: {
      type: "OBJECT",
      properties: {
        amount: { type: "INTEGER", nullable: true },
        date: { type: "STRING", nullable: true },
        vendor: { type: "STRING", nullable: true },
        items: { type: "STRING", nullable: true },
        category: { type: "STRING", enum: categories, nullable: true },
      },
    },
  });
  const { normalizeBill } = await import("./finance");
  return normalizeBill(json, refDate);
}

async function readWithBot(photos: string[], ctx: Record<string, unknown>, refDate: string): Promise<OcrResult> {
  const url = process.env.CLOSING_OCR_URL!;
  const secret = process.env.CLOSING_OCR_SECRET || process.env.CLOSING_WEBHOOK_SECRET;
  const json = await withTimeout(
    40_000,
    async (signal) => {
      const r = await fetch(url, {
        method: "POST",
        signal,
        headers: { "content-type": "application/json", ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
        body: JSON.stringify({ type: "closing_ocr", ...ctx, photos }),
      });
      const text = await r.text();
      if (!r.ok) throw new Error(`Bot đọc ảnh trả lỗi HTTP ${r.status}`);
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("Bot đọc ảnh không trả về JSON");
      }
    },
    "Bot đọc ảnh quá lâu không phản hồi",
  );
  return { ...normalizeOcr(json, refDate), provider: "bot" };
}

export async function readClosingPhotos(
  photos: string[],
  ctx: { store: { code?: string; name?: string }; workDate: string; shift?: { name?: string; start?: string; end?: string } | null; employee?: string },
): Promise<OcrResult> {
  if (!ocrConfigured()) throw new Error("Chưa cấu hình đọc ảnh (GEMINI_API_KEY)");
  const out = process.env.GEMINI_API_KEY ? await readWithGemini(photos, ctx.workDate) : await readWithBot(photos, ctx, ctx.workDate);
  if (!Object.keys(out.values).length && !out.date) throw new Error("Không đọc được số liệu nào từ ảnh – chụp rõ hơn hoặc nhập tay");
  return out;
}
