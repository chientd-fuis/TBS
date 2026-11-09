/*
 * Nội quy tóm tắt: admin viết nội quy đầy đủ (trợ lý AI dùng để trả lời) → AI tóm tắt ~10 điều
 * cho nút "Nội quy" trên app nhân viên. Lưu ở Settings.ai.rulesSummary (admin sửa tay được).
 */
import { parseRules } from "./rules-format";
import { geminiGenerate } from "./ocr";

export const SUMMARY_PROMPT = `Bạn là quản lý quán trà sữa Tiệm Bơ Sầu. Dưới đây là NỘI QUY ĐẦY ĐỦ của quán.
Hãy viết BẢN TÓM TẮT cho nhân viên đọc nhanh trên điện thoại:
- Khoảng 10 điều (tối đa 12), mỗi điều 1–2 câu ngắn, ưu tiên điều quan trọng nhất trước.
- GIỮ NGUYÊN các con số: giờ giấc, số phút, mức phạt, số tiền, số giờ báo trước. KHÔNG bịa thêm quy định, con số không có trong nội quy.
- Định dạng (chỉ dùng đúng các ký hiệu này, không dùng markdown khác, không bọc trong \`\`\`):
  Dòng đầu: "# NỘI QUY TÓM TẮT"
  Mỗi điều: "1. **Tên ngắn:** nội dung" (đánh số 1, 2, 3…)
  Ý phụ quan trọng (nếu cần): dòng bắt đầu "- " ngay dưới điều đó, tối đa 2 ý / điều
  Dòng cuối: "! Xem đầy đủ hoặc thắc mắc: hỏi quản lý ca / Trợ lý cửa hàng."
Chỉ trả về bản tóm tắt.

NỘI QUY ĐẦY ĐỦ:
<<<
{RULES}
>>>`;

/** Làm sạch câu trả lời AI (bỏ ``` bọc ngoài) và kiểm tra có điều mục đánh số. */
export function cleanSummary(raw: unknown): string {
  const s = String(raw ?? "")
    .replace(/^\s*```[a-z]*\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim()
    .slice(0, 6000);
  if (!parseRules(s).some((b) => b.kind === "item")) throw new Error("AI trả về bản tóm tắt không đúng định dạng – thử lại");
  return s;
}

/** Gọi AI tóm tắt nội quy đầy đủ (feature "rulesSummary": tính token, giới hạn lượt). */
export async function summarizeRules(full: string, actor: string): Promise<string> {
  if (!full.trim()) throw new Error("Chưa có nội quy đầy đủ để tóm tắt");
  const t = await geminiGenerate({ feature: "rulesSummary", actor, temperature: 0.2, timeoutMs: 40_000, prompt: SUMMARY_PROMPT.replace("{RULES}", full.slice(0, 8000)) });
  return cleanSummary(t);
}
