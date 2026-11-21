import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { ShiftAssignment, ShiftTemplate, Store } from "@/lib/models";
import { addDays, isYmd, localDate, weekDays, weekStartOf } from "@/lib/time";
import { Alert } from "@/components/ui";
import { WeekNav } from "../WeekNav";
import RegisterForm from "./RegisterForm";
import { loadRegLogs } from "@/lib/shift-reg-log";

export const dynamic = "force-dynamic";

/** Đăng ký ca theo tuần – chỉ tuần tương lai (spec 4.7) */
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const nextWeek = addDays(weekStartOf(localDate(new Date(), tz)), 7);
  const sp = await searchParams;
  let ws = weekStartOf(isYmd(sp.week) ? sp.week : nextWeek);
  if (ws < nextWeek) ws = nextWeek; // không cho đăng ký tuần hiện tại / quá khứ
  const days = weekDays(ws);
  const [tpls, mine, logs] = await Promise.all([
    ShiftTemplate.find({ storeId: user.storeId, active: true }).sort({ startTime: 1 }).lean(),
    ShiftAssignment.find({ userId: user._id, storeId: user.storeId, date: { $gte: days[0], $lte: days[6] } }).lean(),
    user.storeId ? loadRegLogs(String(user.storeId), ws) : Promise.resolve([]),
  ]);
  // lịch sử đăng ký của chính mình (không lộ tên admin – hiện "Quản lý")
  const myLogs = logs.filter((l) => l.userId === String(user._id)).map(({ id, kind, byStaff, at, add, remove }) => ({ id, kind, byStaff, at, add, remove }));
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Đăng ký ca</h1>
        <Link href="/schedule" className="text-sm text-accent underline">← Lịch của tôi</Link>
      </div>
      <WeekNav ws={ws} min={nextWeek} href={(w) => `/schedule/register?week=${w}`} label={ws === nextWeek ? "Tuần sau" : undefined} />
      <p className="text-sm text-ink/70">Bấm ô để chọn ca muốn làm, bấm lại để bỏ. Xong bấm <b>Gửi đăng ký</b> – ca ở trạng thái <b>chờ duyệt</b> cho tới khi admin duyệt.</p>
      {tpls.length === 0 ? (
        <Alert tone="orange">Cơ sở chưa có ca làm việc để đăng ký.</Alert>
      ) : (
        <RegisterForm
          key={ws}
          weekStart={ws}
          days={days}
          templates={tpls.map((t) => ({ id: String(t._id), name: t.name, startTime: t.startTime, endTime: t.endTime }))}
          existing={mine.map((m) => ({ key: `${m.date}|${m.shiftTemplateId}`, status: (m.status ?? "APPROVED") as "PENDING" | "APPROVED" | "REJECTED" }))}
          logs={myLogs}
        />
      )}
    </>
  );
}
