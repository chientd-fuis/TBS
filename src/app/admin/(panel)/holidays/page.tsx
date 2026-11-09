import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { Holiday, Payroll } from "@/lib/models";
import { HOLIDAY_MULTIPLIERS } from "@/lib/holiday";
import { localDate, viDate, weekdayVi } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { addSolarHolidays, deleteHoliday, saveHoliday } from "../../actions/holiday";

export const dynamic = "force-dynamic";

const MultSelect = ({ value = 2 }: { value?: number }) => (
  <Select name="multiplier" defaultValue={String(value)} className="!w-28">
    {HOLIDAY_MULTIPLIERS.map((m) => (
      <option key={m} value={m}>
        ×{m} lương{m === 2 ? " (mặc định)" : ""}
      </option>
    ))}
  </Select>
);

/** Ngày nghỉ lễ – đi làm ngày lễ được nhân lương giờ (mặc định ×2). */
export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requireAdmin();
  const today = localDate(new Date());
  const sp = await searchParams;
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
  const list = await Holiday.find({ date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }).sort({ date: 1 }).lean();
  // bảng lương đã công bố của các tháng có ngày lễ → đổi ngày lễ không tự tính lại
  const locked = await Payroll.countDocuments({ month: { $in: [...new Set(list.map((h) => h.date.slice(0, 7)))] }, status: { $ne: "DRAFT" } });
  return (
    <>
      <PageTitle sub="Nhân viên đi làm ngày lễ được nhân lương giờ (mặc định ×2). Áp dụng cho mọi cơ sở. Bảng lương nháp tự tính lại khi thêm / sửa / xoá.">Ngày nghỉ lễ</PageTitle>
      <Card title="Thêm ngày lễ">
        <ActionForm action={saveHoliday} submitLabel="Thêm ngày lễ" successText="Đã lưu" className="flex flex-wrap items-end gap-2">
          <Field label="Ngày"><Input type="date" name="date" required className="!w-44" /></Field>
          <Field label="Tên ngày lễ"><Input name="name" required placeholder="VD Tết Nguyên đán" className="!w-56" /></Field>
          <Field label="Hệ số lương"><MultSelect /></Field>
        </ActionForm>
        <div className="mt-4 border-t border-[#f1e6c8] pt-3">
          <ActionForm action={addSolarHolidays} submitLabel={`Thêm nhanh lễ dương lịch ${year}`} variant="outline" successText="Đã thêm" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="year" value={year} />
            <Field label="Hệ số"><MultSelect /></Field>
          </ActionForm>
          <p className="mt-1 text-xs text-ink/60">01/01 Tết Dương lịch · 30/04 · 01/05 · 02/09 Quốc khánh. Tết Nguyên đán, Giỗ Tổ Hùng Vương (âm lịch) và ngày nghỉ bù – thêm tay theo lịch từng năm.</p>
        </div>
      </Card>

      <Card
        title={`Ngày lễ năm ${year} (${list.length})`}
        actions={
          <div className="flex gap-1 text-sm">
            <Link href={`/admin/holidays?year=${year - 1}`} className="rounded-lg px-2 py-1 ring-1 ring-[#f1e6c8] hover:bg-primary-light">‹ {year - 1}</Link>
            <Link href={`/admin/holidays?year=${year + 1}`} className="rounded-lg px-2 py-1 ring-1 ring-[#f1e6c8] hover:bg-primary-light">{year + 1} ›</Link>
          </div>
        }
      >
        {locked > 0 && (
          <Alert tone="yellow">
            Có {locked} bảng lương đã công bố trong các tháng có ngày lễ – sửa / xoá ngày lễ sẽ KHÔNG tự tính lại các bảng này. Mở khoá bảng lương nếu cần tính lại.
          </Alert>
        )}
        {!list.length ? (
          <Empty>Chưa có ngày lễ nào trong năm {year}</Empty>
        ) : (
          <ul className="divide-y divide-[#f1e6c8]">
            {list.map((h) => (
              <li key={String(h._id)} className="flex flex-wrap items-end justify-between gap-2 py-2.5">
                <ActionForm action={saveHoliday} submitLabel="Lưu" variant="outline" successText="Đã lưu" className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={String(h._id)} />
                  <Field label={`${weekdayVi(h.date)}${h.date < today ? " · đã qua" : ""}`}><Input type="date" name="date" defaultValue={h.date} required className="!w-44" /></Field>
                  <Field label="Tên"><Input name="name" defaultValue={h.name} required className="!w-56" /></Field>
                  <Field label="Hệ số"><MultSelect value={h.multiplier} /></Field>
                </ActionForm>
                <div className="flex items-end gap-2">
                  <Badge tone="red">×{h.multiplier} · {viDate(h.date)}</Badge>
                  <ActionForm action={deleteHoliday} submitLabel="Xoá" variant="danger" successText="" confirm={`Xoá ngày lễ ${h.name} (${viDate(h.date)})?`}>
                    <input type="hidden" name="id" value={String(h._id)} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
