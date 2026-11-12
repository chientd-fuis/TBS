import HelpNav from "./HelpNav";

/** Khung chung các trang Trợ giúp – đầu trang + hàng tab giữ nguyên khi chuyển mục (không cuộn về đầu). */
export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <HelpNav />
      {children}
    </div>
  );
}
