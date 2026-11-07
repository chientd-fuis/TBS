import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { ShiftClosing } from "@/lib/models";
import { addDays, localTime, viDate } from "@/lib/time";
import { Badge, Card } from "@/components/ui";
import ClosingForm from "./ClosingForm";
import { resolveClosingContext } from "@/lib/closing-context";
import { closingWorkDate, defaultClosingShift, revenueDiff, type ClosingShiftKey, type Revenue } from "@/lib/revenue";

export const dynamic = "force-dynamic";

const TG = { SENT: ["Đã gửi Telegram", "green"], FAILED: ["Gửi lỗi – đang thử lại", "orange"], PENDING: ["Đang gửi", "yellow"], DISABLED: ["Chưa cấu hình Telegram", "gray"] } as const;

/** Chốt ca: nhập số liệu cuối ca → gửi nhóm Telegram */
export default async function ClosingPage() {
  const user = await requireActiveUser();
  const ctx = await resolveClosingContext(user);
  const tz = ctx?.tz || "Asia/Ho_Chi_Minh";
  const att = ctx?.att;
  const shift = ctx?.shift;
  // ca chốt mặc định theo giờ: 8h–16h Sáng, 16h–20h Chiều, 20h–8h Tối (tối sau nửa đêm tính cho hôm trước)
  const hour = Number(localTime(new Date(), tz).slice(0, 2));
  const defaultShift = defaultClosingShift(hour);
  const today = ctx?.today ?? "";
  const dateOf = (k: ClosingShiftKey) => (today ? closingWorkDate(k, today, hour, addDays) : "");
  // các ca đã chốt trước trong ngày của ca Tối (ca cuối thấy tổng ngày trước khi ghi sheet)
  const nightDate = dateOf("T");
  const dayBefore = ctx
    ? (await ShiftClosing.find({ storeId: ctx.store._id, workDate: nightDate, "revenue.dt": { $ne: null } }).sort({ createdAt: 1 }).lean()).map((c) => ({
        label: `${c.shiftName ? `Ca ${c.shiftName}` : "Ngoài ca"} · ${c.employeeName ?? ""}`,
        dt: c.revenue?.dt ?? 0,
        diff: revenueDiff((c.revenue ?? {}) as Partial<Revenue>),
      }))
    : [];
  const recent = await ShiftClosing.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Chốt ca</h1>
        <Link href="/" className="text-sm text-accent underline">← Chấm công</Link>
      </div>
      <ClosingForm
        scheduledShift={shift ? `${shift.shiftName} (${shift.startTime}–${shift.endTime})` : null}
        defaultShift={defaultShift}
        dates={{ S: dateOf("S"), C: dateOf("C"), T: dateOf("T") }}
        checkIn={att ? localTime(att.checkInAt, tz).slice(0, 5) : null}
        employee={`${user.name}${user.phone ? ` · ${user.phone}` : ""}`}
        storeName={ctx?.store.name}
        dayBefore={dayBefore}
      />
      {recent.length > 0 && (
        <Card title="Lần chốt ca gần đây">
          <ul className="space-y-2 text-sm">
            {recent.map((c) => {
              const st = TG[(c.telegram?.status ?? "PENDING") as keyof typeof TG];
              return (
                <li key={String(c._id)} className="flex items-center gap-2">
                  <span className="flex-1">
                    {viDate(c.workDate)} {c.createdAt ? localTime(new Date(c.createdAt), tz).slice(0, 5) : ""}{c.shiftName ? ` · Ca ${c.shiftName}` : ""}
                    {c.revenue?.dt != null && <> · DT <b>{c.revenue.dt.toLocaleString("vi-VN")} đ</b></>}
                    {c.note && <span className="block truncate text-xs text-ink/60">{c.note}</span>}
                  </span>
                  <Badge tone={st[1]}>{st[0]}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
