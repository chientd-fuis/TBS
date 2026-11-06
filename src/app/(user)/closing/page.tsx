import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { Attendance, ShiftClosing, Store } from "@/lib/models";
import { localDate, localTime, viDate } from "@/lib/time";
import { Badge, Card } from "@/components/ui";
import ClosingForm from "./ClosingForm";
import { findShiftForClosing } from "@/lib/attendance";

export const dynamic = "force-dynamic";

const TG = { SENT: ["Đã gửi Telegram", "green"], FAILED: ["Gửi lỗi – đang thử lại", "orange"], PENDING: ["Đang gửi", "yellow"], DISABLED: ["Chưa cấu hình Telegram", "gray"] } as const;

/** Chốt ca: chụp ảnh cuối ca → gửi nhóm Telegram */
export default async function ClosingPage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const today = localDate(new Date(), tz);
  const att =
    (await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean()) ??
    (await Attendance.findOne({ userId: user._id, workDate: today }).sort({ checkInAt: -1 }).lean());
  const shift = await findShiftForClosing(user._id, new Date(), tz, att?.shiftAssignmentId);
  const recent = await ShiftClosing.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean();
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Chốt ca</h1>
        <Link href="/" className="text-sm text-accent underline">← Chấm công</Link>
      </div>
      <ClosingForm
        shiftLabel={shift ? `${shift.shiftName} (${shift.startTime}–${shift.endTime})` : "Ngoài ca"}
        checkIn={att ? localTime(att.checkInAt, tz).slice(0, 5) : null}
        employee={`${user.name}${user.phone ? ` · ${user.phone}` : ""}`}
      />
      {recent.length > 0 && (
        <Card title="Lần chốt ca gần đây">
          <ul className="space-y-2 text-sm">
            {recent.map((c) => {
              const st = TG[(c.telegram?.status ?? "PENDING") as keyof typeof TG];
              return (
                <li key={String(c._id)} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photo?closing=${c._id}&i=0`} alt="" className="h-12 w-12 rounded-lg bg-cream object-cover" />
                  <span className="flex-1">
                    {viDate(c.workDate)} {c.createdAt ? localTime(new Date(c.createdAt), tz).slice(0, 5) : ""} · {c.photos.length} ảnh
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
