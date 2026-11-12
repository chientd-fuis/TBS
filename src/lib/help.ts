/*
 * Help (nút "?" trên app nhân viên): 4 mục do Admin Tổng soạn ở Cài đặt → Help.
 * Nội dung viết theo cùng định dạng nội quy (lib/rules-format.ts): # tiêu đề, 1. bước, - ý nhỏ, **đậm**, ! lưu ý.
 * Lưu trong Settings.help.
 */
export const POSITIONS = [
  { key: "BEP", label: "Bếp", icon: "🍳" },
  { key: "THU_NGAN", label: "Thu ngân", icon: "💵" },
  { key: "SHIP", label: "Ship", icon: "🛵" },
  { key: "DA_NANG", label: "Đa năng", icon: "⭐" },
] as const;
export type PositionKey = (typeof POSITIONS)[number]["key"];
export const isPosition = (v: unknown): v is PositionKey => POSITIONS.some((p) => p.key === v);

export type FaqItem = { q: string; a: string };
export type HelpContent = {
  guide: string; // Hướng dẫn sử dụng app (có thể nhập từ file Word)
  guideFile: string; // tên file Word đã nhập gần nhất
  workflow: Record<PositionKey, string>; // Quy trình làm việc theo vị trí
  about: string; // Thông tin về quán
  faq: FaqItem[]; // Các tình huống hay gặp
};

export const HELP_SECTIONS = [
  { key: "guide", label: "Hướng dẫn sử dụng app", icon: "📱", href: "/help/guide", hint: "Cách dùng các chức năng của app" },
  { key: "workflow", label: "Quy trình làm việc", icon: "🧭", href: "/help/workflow", hint: "Theo vị trí: Bếp, Thu ngân, Ship, Đa năng" },
  { key: "about", label: "Thông tin về quán", icon: "🏪", href: "/help/about", hint: "Giới thiệu, địa chỉ, giờ mở cửa, liên hệ" },
  { key: "faq", label: "Các tình huống hay gặp", icon: "💬", href: "/help/faq", hint: "Hỏi – đáp nhanh khi gặp tình huống" },
] as const;
export type HelpSectionKey = (typeof HELP_SECTIONS)[number]["key"];

const str = (v: unknown, max = 50_000) => (typeof v === "string" ? v : "").slice(0, max);

/** Đọc Settings.help (Mixed) → dạng chuẩn, thiếu thì để trống. */
export function normalizeHelp(raw: unknown): HelpContent {
  const r = (raw ?? {}) as Partial<Record<string, unknown>>;
  const wf = (r.workflow ?? {}) as Record<string, unknown>;
  const faq = Array.isArray(r.faq) ? r.faq : [];
  return {
    guide: str(r.guide),
    guideFile: str(r.guideFile, 200),
    workflow: Object.fromEntries(POSITIONS.map((p) => [p.key, str(wf[p.key])])) as Record<PositionKey, string>,
    about: str(r.about),
    faq: faq
      .map((x) => ({ q: str((x as FaqItem)?.q, 500).trim(), a: str((x as FaqItem)?.a, 5000).trim() }))
      .filter((x) => x.q || x.a)
      .slice(0, 200),
  };
}

/** Mẫu gợi ý cho admin (hiện ở ô trống khi soạn) */
export const HELP_PLACEHOLDER: Record<"guide" | "workflow" | "about", string> = {
  guide: `# CHẤM CÔNG
1. Đến quán bấm **CHECK-IN**, chụp mặt
- Bật GPS / WiFi quán nếu app yêu cầu
2. Về bấm **CHECK-OUT**
! Quên chấm công: vào Lịch sử → gửi yêu cầu bổ sung`,
  workflow: `# ĐẦU CA
1. Thay đồng phục, rửa tay
2. Nhận bàn giao từ ca trước
# TRONG CA
1. ...
# CUỐI CA
1. Dọn dẹp, bàn giao
! Lưu ý quan trọng của vị trí này`,
  about: `# TIỆM BƠ SẦU
Kem & chè sầu riêng.
- **Giờ mở cửa:** 8:00 – 22:30 hằng ngày
- **Cơ sở:** Geleximco · Văn Phú · Đô Nghĩa
- **Quản lý:** tên – SĐT
! Wifi quán: tên / mật khẩu`,
};
