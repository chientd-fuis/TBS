import { aiAllowed, getAiConfig } from "@/lib/ai";
import Link from "next/link";
import { WeekBadge, weekLabel } from "@/components/WeekBadge";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/guards";
import { ShiftAssignment, Store } from "@/lib/models";
import { loadWeek } from "@/lib/schedule-data";
import { addDays, isYmd, localDate, viDate, weekStartOf } from "@/lib/time";
import { Alert, PageTitle } from "@/components/ui";
import ScheduleBoard from "./ScheduleBoard";
import ForecastPanel from "./ForecastPanel";
import { loadWeather } from "@/lib/weather";

export const dynamic = "force-dynamic";

/** Lịch làm việc 1 cơ sở theo tuần – theo mẫu bảng S/C/T × Thứ 2…CN */
export default async function StoreSchedule({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ week?: string }> }) {
  const admin = await requireAdmin();
  const { storeId } = await params;
  const sp = await searchParams;
  const store = await Store.findById(storeId).lean().catch(() => null);
  if (!store) notFound();
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const today = localDate(new Date(), tz);
  // mở màn hình (không chọn tuần): tuần sau đã có nhân viên đăng ký ca chờ duyệt → hiện luôn tuần sau để xếp
  let autoNext = 0;
  let ws = weekStartOf(isYmd(sp.week) ? sp.week : today);
  if (!isYmd(sp.week)) {
    const next = addDays(weekStartOf(today), 7);
    autoNext = await ShiftAssignment.countDocuments({ storeId, status: "PENDING", date: { $gte: next, $lte: addDays(next, 6) } });
    if (autoNext) ws = next;
  }
  const data = await loadWeek(storeId, ws);
  const link = (w: string) => `/admin/schedule/${storeId}?week=${w}`;
  const thisWeek = weekStartOf(today);
  // điều hướng tuần – hiển thị ngay trên bảng xếp ca
  // thời tiết hiện ngay trong tiêu đề cột ngày của lịch
  const weather = (await getAiConfig()).weather.schedule ? Object.fromEntries(await loadWeather(data.days, store.lat, store.lng)) : {};
  const weekNav = (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={link(addDays(ws, -7))} className="rounded-xl bg-card p-2 ring-1 ring-line hover:bg-primary-light" aria-label="Tuần trước"><ChevronLeft size={18} /></Link>
      <span className="text-center font-bold sm:min-w-56">
        {viDate(ws)} – {viDate(addDays(ws, 6))}
        {weekLabel(ws, thisWeek, addDays) && (
          <span className="ml-1">
            (<WeekBadge label={weekLabel(ws, thisWeek, addDays)} />)
          </span>
        )}
      </span>
      <Link href={link(addDays(ws, 7))} className="rounded-xl bg-card p-2 ring-1 ring-line hover:bg-primary-light" aria-label="Tuần sau"><ChevronRight size={18} /></Link>
      {ws !== thisWeek && <Link href={link(thisWeek)} className="text-sm text-accent underline">Về tuần này</Link>}
    </div>
  );
  return (
    <>
      <PageTitle sub="Thao tác trên lịch chỉ là nháp (nét đứt) – bấm Chốt lịch để lưu · cam = chờ duyệt · xanh dương = hỗ trợ từ cơ sở khác">
        <Link href="/admin/schedule" className="text-sm font-normal underline">Xếp ca</Link> / {store.name}
      </PageTitle>
      {autoNext > 0 && (
        <Alert tone="orange">
          Đang mở <b>tuần sau</b> vì có <b>{autoNext} ca đăng ký chờ duyệt</b>.
        </Alert>
      )}
      {data.templates.length > 0 && (await aiAllowed("forecast", `admin:${admin.accountId ?? "owner"}`)) && <ForecastPanel key={ws} storeId={storeId} weekStart={ws} />}
      {data.templates.length === 0 && weekNav}
      {data.templates.length === 0 ? (
        <Alert tone="orange">
          Cơ sở chưa có ca mẫu. <Link className="underline" href={`/admin/shifts?store=${storeId}`}>Tạo ca (VD: S 08:00–13:00, C 13:00–18:00, T 18:00–23:00)</Link>
        </Alert>
      ) : (
        <ScheduleBoard
          key={ws}
          storeId={storeId}
          storeName={store.name}
          weekStart={ws}
          days={data.days}
          today={today}
          templates={data.templates}
          entries={data.entries}
          staff={data.staff}
          names={data.names}
          supportFrom={data.supportFrom}
          external={data.external}
          otherStaff={data.otherStaff}
          regRequests={data.regRequests}
          regLogs={data.regLogs}
          canRequest={ws >= addDays(thisWeek, 7)}
          isPast={addDays(ws, 6) < today}
          weekNav={weekNav}
          weather={weather}
        />
      )}
    </>
  );
}
