import { normalizeOcr, type Revenue } from "./revenue";

/*
 * Đọc số liệu từ ảnh chốt ca.
 * - Mặc định: Google Gemini (GEMINI_API_KEY, tuỳ chọn GEMINI_MODEL – mặc định gemini-2.5-flash)
 * - Dự phòng: bot riêng qua HTTP (CLOSING_OCR_URL / CLOSING_OCR_SECRET)
 */

export type OcrResult = { values: Partial<Revenue>; note?: string; date?: string; cpDetail?: string; staffTotal?: number; scaled?: boolean; provider: string };

export const ocrConfigured = () => !!process.env.GEMINI_API_KEY || !!process.env.CLOSING_OCR_URL;

const GEMINI_PROMPT = `Bạn đọc ẢNH TỜ CHỐT CA của quán trà sữa "Tiệm Bơ Sầu" (Việt Nam) – thường là tờ giấy NHÂN VIÊN GHI TAY, đôi khi là phiếu in máy POS.
Trên tờ ghi tay thường có: ngày + ca ("Ca tối 7/11"), "TM" (tiền mặt), "TK" (tài khoản / chuyển khoản), các khoản chi trong ca (sữa chua, ship, đá…),
Grab, Shopee, có thể có "DTm" (doanh thu máy – do quản lý cấp, KHÔNG phải lúc nào cũng có), và CUỐI TỜ là con số TỔNG do nhân viên tự cộng.
Trích (trả về số nguyên VND):
- dt: CHỈ khi có ghi "DTm" / "DT máy" / "doanh thu máy" (hoặc phiếu in máy POS ghi tổng doanh thu). Không có → null. KHÔNG lấy số tổng cuối tờ làm dt.
- tm: Tiền mặt (TM)
- tk: Tài khoản / chuyển khoản / QR (TK)
- cp: tổng các khoản chi trong ca (cộng lại); khoản THU thêm thì là số âm
- cp_detail: các khoản chi như ghi trên tờ, dạng "30k sữa chua + 20k ship" (null nếu không có)
- grab, shopee: tiền đơn Grab / Shopee nếu có ghi
- staff_total: con số TỔNG nhân viên tự cộng (thường ở cuối tờ, có gạch dưới / khoanh tròn)
- date: ngày ghi trên tờ, dạng YYYY-MM-DD
- note: các dòng khác không thuộc mục trên (VD "6850 Tạ Văn Thắng", "cơm ca chiều"), ngắn gọn
ĐƠN VỊ: tờ ghi tay thường viết theo NGHÌN đồng ("2487" = 2.487.000; "30" = 30.000) → nhân 1000. Phiếu in POS ghi đủ đồng → giữ nguyên. "k" = nghìn, "tr" = triệu.
KHÔNG đoán: số không đọc rõ → null. Chỉ trả về JSON.`;

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
    staff_total: { type: "INTEGER", nullable: true },
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
type GeminiErr = { error?: { code?: number; message?: string; status?: string; details?: { "@type"?: string; violations?: { quotaId?: string; quotaValue?: string }[]; retryDelay?: string }[] } };

/** Danh sách model thử lần lượt: GEMINI_MODEL → GEMINI_FALLBACK_MODELS (mỗi model có hạn mức miễn phí riêng). */
export function geminiModels() {
  const main = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const fb = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-2.5-flash-lite,gemini-3-flash-preview")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return [main, ...fb].filter((m, i, a) => a.indexOf(m) === i);
}

/** Diễn giải lỗi Gemini thành câu dễ hiểu (hết lượt theo ngày / theo phút / quá tải / key sai…). */
export function describeGeminiError(status: number, body: unknown, model: string): { text: string; retryable: boolean } {
  const e = (body as GeminiErr)?.error;
  const msg = e?.message ?? "";
  if (status === 400 && /API key/i.test(msg)) return { text: "GEMINI_API_KEY không hợp lệ", retryable: false };
  if (status === 400 && /location is not supported/i.test(msg))
    return {
      text: "Gemini không hỗ trợ vị trí máy chủ đang gọi (Vercel đang chạy ở Hong Kong) – đổi Function Region sang Singapore (sin1) trong vercel.json hoặc Vercel → Settings → Functions",
      retryable: false,
    };
  if (status === 403) return { text: `Key không có quyền dùng ${model} (${msg.slice(0, 100)})`, retryable: true };
  if (status === 404) return { text: `Không có model ${model}`, retryable: true };
  if (status === 429) {
    const v = e?.details?.flatMap((d) => d.violations ?? []) ?? [];
    const retry = e?.details?.find((d) => d.retryDelay)?.retryDelay;
    const perDay = v.find((x) => /PerDay/i.test(x.quotaId ?? ""));
    const perMin = v.find((x) => /PerMinute/i.test(x.quotaId ?? ""));
    const free = v.some((x) => /FreeTier/i.test(x.quotaId ?? "")) || /free.?tier/i.test(msg);
    if (perDay) return { text: `${model}: hết lượt ${free ? "miễn phí " : ""}trong ngày${perDay.quotaValue ? ` (${perDay.quotaValue} lượt/ngày)` : ""}`, retryable: true };
    if (perMin) return { text: `${model}: quá nhiều lượt trong 1 phút${retry ? `, thử lại sau ${retry}` : ""}`, retryable: true };
    return { text: `${model}: hết hạn mức${free ? " miễn phí" : ""}${retry ? `, thử lại sau ${retry}` : ""}`, retryable: true };
  }
  if (status === 503 || status === 500 || status === 504) return { text: `${model}: máy chủ Google đang quá tải`, retryable: true };
  return { text: `${model}: lỗi HTTP ${status}${msg ? ` – ${msg.slice(0, 120)}` : ""}`, retryable: false };
}

/**
 * Gọi Gemini (generateContent). photos = data URL ảnh. schema có → trả JSON đã parse, không có → trả text.
 * Model chính hết lượt / quá tải → tự chuyển sang model dự phòng.
 */
export async function geminiGenerate(opts: { prompt: string; photos?: string[]; schema?: object; timeoutMs?: number; temperature?: number }): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Chưa cấu hình GEMINI_API_KEY");
  const parts: unknown[] = [{ text: opts.prompt }];
  for (const p of opts.photos ?? []) {
    const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(p);
    if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
  }
  const payload = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0,
      ...(opts.schema ? { responseMimeType: "application/json", responseSchema: opts.schema } : {}),
    },
  });
  const deadline = Date.now() + (opts.timeoutMs ?? 50_000);
  const errors: string[] = [];
  let quota = false;
  for (const model of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const left = deadline - Date.now();
      if (left < 3_000) break;
      let res: { ok: true; body: unknown } | { ok: false; status: number; body: unknown };
      try {
        res = await withTimeout(
          Math.min(left, 30_000),
          async (signal) => {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
              method: "POST",
              signal,
              headers: { "content-type": "application/json", "x-goog-api-key": key },
              body: payload,
            });
            const j = await r.json().catch(() => ({}));
            return r.ok ? { ok: true as const, body: j } : { ok: false as const, status: r.status, body: j };
          },
          `${model}: đọc quá lâu`,
        );
      } catch (e) {
        errors.push((e as Error).message);
        break; // quá lâu → thử model khác
      }
      if (res.ok) {
        if (opts.schema) return parseGeminiResponse(res.body);
        const b = res.body as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        return (b.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
      }
      const d = describeGeminiError(res.status, res.body, model);
      if (!d.retryable) throw new Error(d.text);
      if (res.status === 429) quota = true;
      // quá tải tạm thời (503) → chờ chút thử lại đúng model này 1 lần; hết lượt → sang model khác luôn
      if (attempt === 0 && res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      errors.push(d.text);
      break;
    }
  }
  throw new Error(
    `Gemini chưa đọc được: ${errors.join("; ") || "hết thời gian"}.` +
      (quota ? " Gói miễn phí đã hết lượt – bật billing cho API key (aistudio.google.com → Billing) hoặc thử lại sau." : " Thử lại sau ít phút hoặc nhập tay."),
  );
}

async function readWithGemini(photos: string[], refDate: string): Promise<OcrResult> {
  const json = await geminiGenerate({ prompt: GEMINI_PROMPT, photos, schema: SCHEMA });
  return { ...normalizeOcr(json, refDate), provider: "gemini" };
}

/* ---------- Sao kê / biên lai chuyển khoản / bill chi phí ---------- */
const STATEMENT_PROMPT = `Ảnh là chứng từ chi tiền của chủ quán trà sữa ở Việt Nam, 1 trong các loại:
(a) SAO KÊ / LỊCH SỬ GIAO DỊCH ngân hàng hoặc ví (nhiều giao dịch trên 1 ảnh),
(b) BIÊN LAI CHUYỂN KHOẢN thành công (1 giao dịch),
(c) hoá đơn / bill mua hàng (1 giao dịch).
Liệt kê TẤT CẢ giao dịch nhìn thấy trong "transactions", mỗi giao dịch:
- direction: "OUT" nếu là TIỀN RA / chi / chuyển đi (thường có dấu "-" hoặc màu đỏ), "IN" nếu là tiền vào (dấu "+", màu xanh, "nhận tiền")
- amount: số tiền giao dịch (số nguyên VND, không lấy SỐ DƯ, không lấy phí)
- date: ngày giao dịch YYYY-MM-DD; time: giờ HH:mm nếu có
- recipient: tên người / đơn vị nhận tiền (bill mua hàng → tên cửa hàng)
- transfer_note: NỘI DUNG CHUYỂN KHOẢN nguyên văn (bill → null)
- purpose: tiền này chi cho việc gì, ngắn gọn tiếng Việt, suy từ nội dung CK / người nhận / các món trên bill (VD "Nhập sữa tươi", "Tiền điện T10", "Lương T10 cho Lan")
- category: một trong {CATS}. LUONG CHỈ KHI nội dung ghi rõ lương / thưởng / tạm ứng nhân viên.
  Nội dung không rõ ràng, không đoán được chi cho việc gì → KHAC (không được chọn LUONG).
Giao dịch bị cắt mất ở mép ảnh, không đọc rõ số tiền → bỏ qua. KHÔNG đoán. "k" = nghìn, "tr" = triệu. Chỉ trả về JSON.`;

/** Đọc 1 ảnh sao kê / biên lai CK / bill → danh sách giao dịch TIỀN RA. */
export async function readStatementPhoto(photo: string, refDate: string, categories: string[]) {
  const json = await geminiGenerate({
    prompt: STATEMENT_PROMPT.replace("{CATS}", categories.join(", ")),
    photos: [photo],
    timeoutMs: 55_000,
    schema: {
      type: "OBJECT",
      properties: {
        transactions: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              direction: { type: "STRING", enum: ["OUT", "IN"], nullable: true },
              amount: { type: "INTEGER", nullable: true },
              date: { type: "STRING", nullable: true },
              time: { type: "STRING", nullable: true },
              recipient: { type: "STRING", nullable: true },
              transfer_note: { type: "STRING", nullable: true },
              purpose: { type: "STRING", nullable: true },
              category: { type: "STRING", enum: categories, nullable: true },
            },
          },
        },
      },
    },
  });
  const { normalizeStatement } = await import("./finance");
  return normalizeStatement(json, refDate);
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
