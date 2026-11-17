/** Tóm tắt dữ liệu app thu (form đăng ký) – đầy đủ ở trang /privacy do Admin Tổng soạn. */
const ITEMS = [
  { ic: "📷", what: "Ảnh khuôn mặt lúc chấm công", why: "Xác nhận đúng người" },
  { ic: "📍", what: "Vị trí GPS / mạng WiFi lúc bấm chấm công", why: "Xác nhận bạn đang ở quán – không theo dõi ngoài lúc bấm" },
  { ic: "📱", what: "Thiết bị (mã máy, trình duyệt, IP)", why: "Chặn chấm công hộ trên máy khác" },
  { ic: "👤", what: "Họ tên, SĐT, Gmail", why: "Liên hệ, xếp ca, thông báo" },
  { ic: "💳", what: "Số tài khoản ngân hàng (được mã hoá)", why: "Chuyển lương" },
];

export default function PrivacySummary() {
  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <p className="flex items-center gap-2 font-bold text-accent">🔒 App sẽ lưu những gì của bạn</p>
      <p className="mb-1 mt-0.5 text-xs text-ink/60">Chỉ dùng để chấm công, xếp ca và trả lương. Không bán, không dùng quảng cáo.</p>
      <ul>
        {ITEMS.map((x) => (
          <li key={x.ic} className="flex items-start gap-2.5 border-t border-line py-2 text-sm first:border-t-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-cream text-sm">{x.ic}</span>
            <span>
              <b>{x.what}</b>
              <span className="block text-xs text-ink/60">{x.why}</span>
            </span>
          </li>
        ))}
      </ul>
      <a href="/privacy" target="_blank" className="mt-1 inline-block text-sm font-bold text-accent underline">
        Xem đầy đủ Chính sách quyền riêng tư →
      </a>
    </section>
  );
}
