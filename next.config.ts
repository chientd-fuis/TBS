import type { NextConfig } from "next";

/**
 * Thiết lập bảo mật cho trình duyệt (mọi trang):
 *  - không cho trang khác nhúng app vào khung (chống lừa bấm nút – clickjacking)
 *  - không đoán sai loại file, không gửi đường dẫn đầy đủ sang trang khác
 *  - chỉ app này được dùng camera (chấm công) / vị trí; tắt micro, cổng thanh toán…
 *  - luôn dùng HTTPS
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["mongoose", "exceljs", "@googleapis/drive"],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }, // ảnh chấm công base64
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
