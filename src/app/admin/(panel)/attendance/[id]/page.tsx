import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { Attendance, AttendanceAdjustment, Store, User } from "@/lib/models";
import { localTime, viDate, viDateTime } from "@/lib/time";
import { isMonthLocked, payStoreOf } from "@/lib/attendance";
import { AttendanceTable, type AttRow } from "@/components/AttendanceTable";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Card, Field, Input, PageTitle, Textarea } from "@/components/ui";
import { deleteAttendance, editAttendance } from "../../../actions/ops";
import TimeInput from "@/components/TimeInput";

export const dynamic = "force-dynamic";

export default async function EditAttendance({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const a = await Attendance.findById(id).lean().catch(() => null);
  if (!a) notFound();
  const [user, store, history] = await Promise.all([
    User.findById(a.userId).lean(),
    Store.findById(a.storeId).lean(),
    AttendanceAdjustment.find({ attendanceId: a._id }).sort({ createdAt: -1 }).lean(),
  ]);
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const locked = await isMonthLocked(payStoreOf(a), a.month);
  const back = `/admin/attendance?store=${a.storeId}&user=${a.userId}&month=${a.month}`;
  return (
    <>
      <PageTitle sub={`${store?.name} · ${viDate(a.workDate)}`}>
        <Link href={back} className="text-sm font-normal underline">Bảng chấm công</Link> / Sửa lượt chấm của {user?.name}
      </PageTitle>
      <Card><AttendanceTable rows={[a as AttRow]} tz={tz} /></Card>
      {locked ? (
        <Alert tone="yellow">🔒 Tháng đã chốt bảng lương – mở khoá ở mục Bảng lương để sửa.</Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Sửa giờ">
            <ActionForm action={editAttendance} submitLabel="Lưu thay đổi">
              <input type="hidden" name="id" value={id} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="Ngày"><Input type="date" name="date" defaultValue={a.workDate} /></Field>
                <Field label="Giờ vào"><TimeInput seconds name="inTime" defaultValue={localTime(a.checkInAt, tz)} /></Field>
                <Field label="Giờ ra"><TimeInput seconds name="outTime" defaultValue={a.checkOutAt ? localTime(a.checkOutAt, tz) : ""} /></Field>
              </div>
              <label className="flex items-center gap-2 rounded-lg bg-primary-light px-2 py-1.5 text-sm font-semibold">
                <input type="checkbox" name="plusHalf" defaultChecked={(a.extraHours ?? 0) > 0} className="h-4 w-4 accent-[#3c9c54]" />
                +0,5h cho ca này <span className="text-xs font-normal text-ink/60">(cộng vào giờ tính công)</span>
              </label>
              <Field label="Ghi chú" hint="Không bắt buộc · nhân viên xem được ở Lịch sử chấm công"><Textarea name="note" rows={2} defaultValue={a.staffNote ?? ""} /></Field>
            </ActionForm>
          </Card>
          <Card title="Xoá lượt chấm công">
            <ActionForm action={deleteAttendance} submitLabel="Xoá" variant="danger" confirm="Xoá lượt chấm công này?">
              <input type="hidden" name="id" value={id} />
              <Field label="Lý do xoá"><Textarea name="reason" rows={2} required /></Field>
            </ActionForm>
          </Card>
        </div>
      )}
      <Card title="Lịch sử chỉnh sửa">
        {history.length === 0 ? (
          <p className="text-sm text-ink/60">Chưa có</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((h) => (
              <li key={String(h._id)}>
                {viDateTime(h.createdAt)} · <b>{h.adminName}</b> · {h.action} · {h.reason}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
