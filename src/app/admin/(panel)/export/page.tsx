import { requirePerm } from "@/lib/guards";
import { Store, User } from "@/lib/models";
import { localMonth } from "@/lib/time";
import { EXPORT_TYPES } from "@/lib/export";
import { Button, Card, Field, Input, PageTitle, Select } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Xuất Excel – 7 loại báo cáo (spec 3.8) */
export default async function ExportPage() {
  await requirePerm("export");
  const stores = await Store.find().sort({ name: 1 }).lean();
  const users = await User.find({ status: { $in: ["ACTIVE", "INACTIVE"] } }).sort({ name: 1 }).lean();
  const storeName = new Map(stores.map((s) => [String(s._id), s.name]));
  const m = localMonth(new Date());
  return (
    <>
      <PageTitle sub="File chứa STK, lương – mỗi lần xuất đều được ghi lịch sử. Tối đa 12 tháng / lần.">Xuất Excel</PageTitle>
      <Card>
        <form action="/api/admin/export" method="GET" className="space-y-4">
          <Field label="Loại báo cáo">
            <Select name="type" defaultValue="tonghopthang">
              {Object.entries(EXPORT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Từ tháng"><Input type="month" name="from" defaultValue={m} required /></Field>
            <Field label="Đến tháng"><Input type="month" name="to" defaultValue={m} required /></Field>
          </div>
          <Field label="Cơ sở" hint="Không chọn = tất cả cơ sở. Giữ Ctrl/⌘ để chọn nhiều.">
            <Select name="store" multiple className="h-28">
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Nhân viên" hint="Không chọn = tất cả nhân viên của các cơ sở đã chọn.">
            <Select name="user" multiple className="h-40">
              {users.map((u) => <option key={String(u._id)} value={String(u._id)}>{u.name} – {storeName.get(String(u.storeId))}{u.status === "INACTIVE" ? " (nghỉ)" : ""}</option>)}
            </Select>
          </Field>
          <Button type="submit">⬇️ Tải file Excel</Button>
        </form>
      </Card>
      <Card title="Nội dung từng loại">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            <b>Tổng hợp tháng</b> (chỉ chủ, cả chuỗi – bỏ qua lọc cơ sở / nhân viên): <b>mỗi tháng 1 sheet</b> gồm A. Lãi lỗ tháng (doanh thu từng cơ sở: TK, TM,
            Shopee/Grab, két, DT máy · lương từng cơ sở · chi phí nguyên liệu / điện nước / khác · mặt bằng · phí sàn · tổng chi phí · lãi, biên lãi) · B. Doanh thu &amp; lãi
            theo ngày × cơ sở · C. Chi tiết từng lượt chốt ca (âm/dương, NV cộng đúng/sai) · D. Chi phí admin nhập · E. Mặt bằng · F. Chấm công theo cơ sở (không chi tiết
            từng nhân viên).
          </li>
          <li><b>Bảng chấm công chi tiết + Tổng hợp</b>: mỗi nhân viên 1 sheet (Ngày, Giờ Đến, Giờ Về, Tổng, Format, Giờ tính công, Ca, Muộn, Sớm, Nguồn, Ghi chú) + sheet Summary.</li>
          <li><b>Tổng hợp</b>: mỗi nhân viên 1 dòng – giờ công, ngày công, số lần muộn/sớm, quên check-out, chấm hộ.</li>
          <li><b>Bảng lương</b>: giờ công, lương giờ, lương CB, phụ cấp, thưởng, phạt, tạm ứng, thực nhận, trạng thái.</li>
          <li><b>Thưởng / phạt</b>: ngày, nhân viên, loại, số tiền, nội dung, người nhập.</li>
          <li><b>Chuyển khoản</b>: họ tên, ngân hàng, STK, số tiền, nội dung CK (VD &quot;TBS luong 11/2026 - Nguyen Van A&quot;).</li>
          <li><b>Nhân viên</b>: thông tin, STK, lương giờ, cơ sở, trạng thái.</li>
          <li><b>Lịch ca</b>: dạng lưới nhân viên × ngày.</li>
        </ul>
      </Card>
    </>
  );
}
