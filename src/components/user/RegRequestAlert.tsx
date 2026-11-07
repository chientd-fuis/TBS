import { CalendarPlus, TriangleAlert } from "lucide-react";
import type { Types } from "mongoose";
import { ShiftRegRequest } from "@/lib/models";
import { addDays, localDate, viDate, weekStartOf } from "@/lib/time";
import { LinkButton } from "@/components/ui";
import WeekOffButton from "./WeekOffButton";

/** Cảnh báo "chưa đăng ký ca tuần …" khi admin gửi yêu cầu đăng ký ca (hiện ở mọi màn hình nhân viên). */
export default async function RegRequestAlert({ userId, tz }: { userId: Types.ObjectId; tz: string }) {
  const nextWeek = addDays(weekStartOf(localDate(new Date(), tz)), 7);
  // tuần đã bắt đầu thì không đăng ký được nữa → bỏ qua yêu cầu cũ
  const reqs = await ShiftRegRequest.find({ userId, status: "OPEN", weekStart: { $gte: nextWeek } }).sort({ weekStart: 1 }).lean();
  if (!reqs.length) return null;
  return (
    <div className="space-y-2">
      {reqs.map((r) => (
        <div key={String(r._id)} className="rounded-2xl bg-[#fff4e5] p-3 text-sm text-warn ring-1 ring-warn/40">
          <p className="flex items-start gap-2">
            <TriangleAlert size={18} className="mt-0.5 shrink-0" />
            <span>
              Bạn <b>chưa đăng ký ca</b> tuần <b>{viDate(r.weekStart).slice(0, 5)} – {viDate(addDays(r.weekStart, 6)).slice(0, 5)}</b>
              {r.requestedBy ? <> · {r.requestedBy} yêu cầu</> : null}
            </span>
          </p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <WeekOffButton weekStart={r.weekStart} />
            <LinkButton href={`/schedule/register?week=${r.weekStart}`} className="px-3 py-1.5">
              <CalendarPlus size={16} /> Đăng ký ca
            </LinkButton>
          </div>
        </div>
      ))}
    </div>
  );
}
