import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { APPROVED_SHIFT, ShiftAssignment, ShiftTemplate, Store, User } from "@/lib/models";
import { addDays, localDate, viDate } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { assignShifts, copyPrevWeek, removeAssignment, saveShiftTemplate } from "../../actions/ops";
import TimeInput from "@/components/TimeInput";

export const dynamic = "force-dynamic";
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

function mondayOf(ymd: string) {
  const wd = new Date(ymd + "T00:00:00Z").getUTCDay();
  return addDays(ymd, wd === 0 ? -6 : 1 - wd);
}

/** Tạo ca & xếp ca (spec 3.2) – ca chỉ dùng tính đi muộn / về sớm */
export default async function ShiftsPage({ searchParams }: { searchParams: Promise<{ store?: string; week?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  if (!store) return <p>Chưa có cơ sở</p>;
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const week = mondayOf(/^\d{4}-\d{2}-\d{2}$/.test(sp.week || "") ? sp.week! : localDate(new Date(), tz));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const [templates, staff, assigns] = await Promise.all([
    ShiftTemplate.find({ storeId: store._id }).sort({ startTime: 1 }).lean(),
    User.find({ storeId: store._id, status: "ACTIVE" }).sort({ name: 1 }).lean(),
    ShiftAssignment.find({ storeId: store._id, date: { $gte: days[0], $lte: days[6] }, ...APPROVED_SHIFT }).sort({ startTime: 1 }).lean(),
  ]);
  const link = (w: string) => `/admin/shifts?store=${store._id}&week=${w}`;
  return (
    <>
      <PageTitle sub="Ca làm việc chỉ dùng để cảnh báo đi muộn / về sớm, không dùng tính lương">Ca làm việc</PageTitle>
      <div className="flex flex-wrap gap-2">
        {stores.map((s) => (
          <Link key={String(s._id)} href={`/admin/shifts?store=${s._id}&week=${week}`} className={`rounded-xl px-3 py-1.5 text-sm ${String(s._id) === String(store._id) ? "bg-primary text-on-primary font-bold" : "bg-card ring-1 ring-line"}`}>
            {s.name}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Ca mẫu">
          <ul className="mb-3 space-y-2 text-sm">
            {templates.map((t) => (
              <li key={String(t._id)} className="rounded-xl bg-cream p-2">
                <ActionForm action={saveShiftTemplate} submitLabel="Lưu" successText="" variant="outline" className="flex flex-wrap items-end gap-1">
                  <input type="hidden" name="id" value={String(t._id)} />
                  <input type="hidden" name="storeId" value={String(store._id)} />
                  <Input name="name" defaultValue={t.name} className="w-28" />
                  <TimeInput name="startTime" defaultValue={t.startTime} className="w-28" />
                  <TimeInput name="endTime" defaultValue={t.endTime} className="w-28" />
                  <Select name="active" defaultValue={t.active ? "on" : "off"} className="w-24">
                    <option value="on">Dùng</option>
                    <option value="off">Ẩn</option>
                  </Select>
                  <label className="flex flex-col text-xs text-ink/60" title="Đổi giờ / tên ca → cập nhật các ca đã xếp từ ngày này + tính lại đi muộn / về sớm (bỏ qua tháng đã trả lương)">
                    Áp dụng từ
                    <Input type="date" name="applyFrom" defaultValue={localDate(new Date(), tz)} className="w-36" />
                  </label>
                </ActionForm>
                {t.endTime < t.startTime && <Badge tone="pink">Qua đêm</Badge>}
              </li>
            ))}
          </ul>
          <ActionForm action={saveShiftTemplate} submitLabel="Thêm ca" successText="Đã thêm">
            <input type="hidden" name="storeId" value={String(store._id)} />
            <Field label="Tên ca"><Input name="name" placeholder="VD: Ca sáng" required /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Bắt đầu"><TimeInput name="startTime" required /></Field>
              <Field label="Kết thúc"><TimeInput name="endTime" required /></Field>
            </div>
          </ActionForm>
        </Card>

        <Card title="Xếp ca" className="xl:col-span-2">
          <ActionForm action={assignShifts} submitLabel="Xếp ca" successText="Đã xếp ca">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Ca">
                <Select name="templateId" required>
                  {templates.filter((t) => t.active).map((t) => (
                    <option key={String(t._id)} value={String(t._id)}>{t.name} ({t.startTime}–{t.endTime})</option>
                  ))}
                </Select>
              </Field>
              <Field label="Từ ngày"><Input type="date" name="from" defaultValue={days[0]} required /></Field>
              <Field label="Đến ngày"><Input type="date" name="to" defaultValue={days[6]} required /></Field>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-accent">Thứ trong tuần (bỏ trống = tất cả)</p>
              <div className="flex flex-wrap gap-3 text-sm">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex items-center gap-1"><input type="checkbox" name="weekdays" value={d} className="accent-secondary" /> {WD[d]}</label>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-accent">Nhân viên</p>
              <div className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
                {staff.map((u) => (
                  <label key={String(u._id)} className="flex items-center gap-1"><input type="checkbox" name="userIds" value={String(u._id)} className="accent-secondary" /> {u.name}</label>
                ))}
              </div>
            </div>
          </ActionForm>
        </Card>
      </div>

      <Card
        title={`Lịch tuần ${viDate(days[0])} – ${viDate(days[6])}`}
        actions={
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Link className="underline" href={link(addDays(week, -7))}>← Tuần trước</Link>
            <Link className="underline" href={link(addDays(week, 7))}>Tuần sau →</Link>
            <ActionForm action={copyPrevWeek} submitLabel="Copy lịch tuần trước" variant="outline" successText="Đã copy" className="inline-block" confirm="Copy toàn bộ lịch tuần trước sang tuần này?">
              <input type="hidden" name="storeId" value={String(store._id)} />
              <input type="hidden" name="weekStart" value={week} />
            </ActionForm>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="tbs">
            <thead>
              <tr>
                <th>Nhân viên</th>
                {days.map((d) => <th key={d}>{WD[new Date(d + "T00:00:00Z").getUTCDay()]} {d.slice(8)}/{d.slice(5, 7)}</th>)}
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={String(u._id)}>
                  <td className="font-semibold whitespace-nowrap">{u.name}</td>
                  {days.map((d) => (
                    <td key={d} className="min-w-28 align-top">
                      {assigns
                        .filter((a) => String(a.userId) === String(u._id) && a.date === d)
                        .map((a) => (
                          <div key={String(a._id)} className="mb-1 flex items-center gap-1 rounded-lg bg-primary-light px-1.5 py-0.5 text-xs">
                            <span className="flex-1">{a.shiftName}<br />{a.startTime}–{a.endTime}</span>
                            <ActionForm action={removeAssignment} submitLabel="×" variant="ghost" successText="" className="inline">
                              <input type="hidden" name="id" value={String(a._id)} />
                            </ActionForm>
                          </div>
                        ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
