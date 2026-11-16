import { getSettings } from "./settings";

/**
 * Bật / tắt ĐỌC ẢNH bằng AI theo từng chức năng (Cài đặt → Đọc ảnh bằng AI, Admin Tổng). Mặc định bật hết.
 * Tắt → không hiện nút chụp ảnh / phiếu cho AI đọc (vẫn gõ tay / chụp ảnh lưu kèm như cũ). Lưu danh sách TẮT (Settings.aiPhotoOff).
 * Đây là công tắc riêng từng màn; giới hạn token / tắt hẳn AI vẫn ở Cài đặt AI.
 */
export const AI_PHOTO_KEYS = [
  { key: "closing", label: "📷 Chốt ca – đọc ảnh tờ chốt ca, tự điền số" },
  { key: "receive", label: "📦 Nhận hàng – đọc ảnh tin nhắn / phiếu nhận" },
  { key: "return", label: "↩ Trả hàng – đọc ảnh tin nhắn / phiếu trả" },
  { key: "stock", label: "📋 Tồn kho – đọc ảnh phiếu kiểm kê" },
] as const;
export type AiPhotoKey = (typeof AI_PHOTO_KEYS)[number]["key"];

export async function aiPhotoOn(key: AiPhotoKey) {
  const s = await getSettings().catch(() => null);
  return !(s?.aiPhotoOff as string[] | undefined)?.includes(key);
}
