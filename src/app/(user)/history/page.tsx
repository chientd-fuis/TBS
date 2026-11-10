import { requireActiveUser } from "@/lib/guards";
import { AdjustmentRequest, Attendance, Store } from "@/lib/models";
import { localDate, localMonth, viDate } from "@/lib/time";
import { hoursVi } from "@/lib/format";
import { AttendanceTable, summarize } from "@/components/AttendanceTable";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Input, Textarea } from "@/components/ui";
import { submitAdjustment } from "../actions";
import TimeInput from "@/components/TimeInput";
import { labelSupport } from "@/lib/support";

export const dynamic = "force-dynamic";

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const { month: m } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(m || "") ? m! : localMonth(new Date(), tz);
  const today = localDate(new Date(), tz);
  const rows = await labelSupport(await Attendance.find({ userId: user._id, month }).sort({ checkInAt: -1 }).lean());
  const sum = summarize(rows);
  const requests = await AdjustmentRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean();

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Chấm công</h1>
        <MonthPicker month={month} base="/history" />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Card className="!p-3"><p className="text-xs">Giờ công</p><p className="text-xl font-bold">{hoursVi(sum.totalRounded)}</p></Card>
        <Card className="!p-3"><p className="text-xs">Ngày công</p><p className="text-xl font-bold">{sum.workDays}</p></Card>
        <Card className="!p-3"><p className="text-xs">Muộn / Sớm</p><p className="text-xl font-bold text-warn">{sum.late} / {sum.early}</p></Card>
      </div>
      {sum.missing > 0 && <p className="text-sm text-danger">Có {sum.missing} lượt quên check-out – hãy gửi yêu cầu điều chỉnh bên dưới.</p>}
      <AttendanceTable rows={rows} tz={tz} staffView />

      <Card title="Gửi yêu cầu điều chỉnh">
        <ActionForm action={submitAdjustment} submitLabel="Gửi yêu cầu" successText="Đã gửi – chờ admin duyệt">
          <p className="text-xs text-ink/70">Dùng khi quên chấm công, quên check-out, GPS/camera lỗi…</p>
          <Field label="Ngày"><Input type="date" name="workDate" required defaultValue={today} max={today} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Giờ vào"><TimeInput name="checkInTime" /></Field>
            <Field label="Giờ ra"><TimeInput name="checkOutTime" /></Field>
          </div>
          <Field label="Lý do"><Textarea name="reason" rows={2} required /></Field>
        </ActionForm>
        {requests.length > 0 && (
          <ul className="mt-4 space-y-2 text-sm">
            {requests.map((r) => (
              <li key={String(r._id)} className="rounded-xl bg-cream p-2">
                <div className="flex items-center justify-between gap-2">
                  <span>{r.workDate && viDate(r.workDate)} · {r.checkInTime || "--"} → {r.checkOutTime || "--"}</span>
                  <Badge tone={r.status === "APPROVED" ? "green" : r.status === "REJECTED" ? "red" : "yellow"}>
                    {r.status === "APPROVED" ? "Đã duyệt" : r.status === "REJECTED" ? "Từ chối" : "Chờ duyệt"}
                  </Badge>
                </div>
                <p className="text-xs text-ink/70">{r.reason}</p>
                {r.adminReply && <p className="text-xs">Admin: {r.adminReply}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
