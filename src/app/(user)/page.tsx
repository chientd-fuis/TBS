import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { APPROVED_SHIFT, Attendance, ShiftAssignment, Store } from "@/lib/models";
import { localDate, localTime, viDate } from "@/lib/time";
import { Badge, Card } from "@/components/ui";
import CheckInWidget from "@/components/user/CheckInWidget";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const open = await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean();
  const today = localDate(new Date(), tz);
  const shifts = await ShiftAssignment.find({ userId: user._id, date: today, ...APPROVED_SHIFT }).sort({ startTime: 1 }).lean();
  const todayAtts = await Attendance.find({ userId: user._id, workDate: today }).sort({ checkInAt: 1 }).lean();

  return (
    <>
      <CheckInWidget openSince={open ? localTime(open.checkInAt, tz) : null} storeName={store?.name || ""} />
      <Link
        href="/closing"
        className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#f1e6c8] hover:bg-primary-light"
      >
        <span>
          <span className="block font-bold text-accent">📷 Chốt ca</span>
          <span className="text-xs text-ink/70">Chụp ảnh cuối ca, gửi vào nhóm Telegram của quán</span>
        </span>
        <span className="text-xl text-accent">›</span>
      </Link>
      <Card title={`Hôm nay · ${viDate(today)}`}>
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-accent">Ca được xếp</p>
          {shifts.length ? (
            shifts.map((s) => (
              <p key={String(s._id)}>
                {s.shiftName}: {s.startTime} – {s.endTime}
              </p>
            ))
          ) : (
            <p className="text-ink/60">Không có ca</p>
          )}
          <p className="pt-2 font-semibold text-accent">Lượt chấm công</p>
          {todayAtts.length ? (
            todayAtts.map((a) => (
              <div key={String(a._id)} className="flex flex-wrap items-center gap-2">
                <span>
                  {localTime(a.checkInAt, tz)} → {a.checkOutAt ? localTime(a.checkOutAt, tz) : "…"}
                </span>
                {a.roundedHours != null && <Badge tone="yellow">{a.roundedHours}h</Badge>}
                {!!a.lateMinutes && <Badge tone="orange">Muộn {a.lateMinutes}&apos;</Badge>}
                {!!a.earlyMinutes && <Badge tone="orange">Sớm {a.earlyMinutes}&apos;</Badge>}
                {a.source === "ADMIN_MANUAL" && <Badge tone="green">Chấm hộ</Badge>}
              </div>
            ))
          ) : (
            <p className="text-ink/60">Chưa có</p>
          )}
        </div>
      </Card>
    </>
  );
}
