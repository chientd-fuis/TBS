import type { Metadata, Viewport } from "next";
import "./globals.css";
import PullToRefresh from "@/components/PullToRefresh";

export const metadata: Metadata = {
  title: "Tiệm Bơ Sầu – Chấm công",
  description: "Chấm công bằng khuôn mặt cho chuỗi Tiệm Bơ Sầu",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "TBS Chấm công", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

// Toàn bộ app đọc dữ liệu theo phiên đăng nhập → render động
export const dynamic = "force-dynamic";

export const viewport: Viewport = { themeColor: "#FCCC18", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <PullToRefresh />
      </body>
    </html>
  );
}
