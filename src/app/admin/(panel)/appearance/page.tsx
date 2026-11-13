import { requireAdmin } from "@/lib/guards";
import { Card, PageTitle } from "@/components/ui";
import ThemePicker from "@/components/user/ThemePicker";
import { adminThemeOf } from "@/lib/theme-server";
import { setAdminTheme } from "../../actions/appearance";

export const dynamic = "force-dynamic";

/** Giao diện trang quản lý – mọi admin tự chọn màu cho mình (lưu theo Gmail). Link ở thanh trên (máy tính) / menu ☰ (điện thoại). */
export default async function AppearancePage() {
  const admin = await requireAdmin();
  const current = await adminThemeOf(admin.email);
  return (
    <>
      <PageTitle sub="Màu trang quản lý của riêng bạn – không đổi màu của admin khác hay app nhân viên">Giao diện</PageTitle>
      <Card title="Màu giao diện" className="max-w-xl">
        <ThemePicker current={current} save={setAdminTheme} admin />
        <p className="mt-3 text-xs text-ink/60">
          Ô xem trước: thanh trên = màu menu admin, 2 nút nhỏ = nút chính / nút phụ. <b>Tối</b> = nền tối, dịu mắt khi làm buổi tối. Màu app nhân viên chọn riêng ở app
          (Tài khoản → Màu giao diện).
        </p>
      </Card>
    </>
  );
}
