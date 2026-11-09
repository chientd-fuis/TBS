import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { WeekBadge, weekLabel } from "@/components/WeekBadge";
import { requireStaff } from "@/lib/staff-guard";
import { Store } from "@/lib/models";
import { loadWeek } from "@/lib/schedule-data";
import { addDays, isYmd, localDate, viDate, weekStartOf } from "@/lib/time";
import { Alert, PageTitle } from "@/components/ui";
import ScheduleBoard from "@/app/admin/(panel)/schedule/[storeId]/ScheduleBoard";

export const dynamic = "force-dynamic";

/** Nhân viên được cấp quyền xếp ca: cùng bảng xếp ca với admin, chỉ ở cơ sở được giao. Mọi thao tác ghi nhật ký cho admin. */
export default async function ManageStoreSchedule({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ week?: string }> }) {
  const { storeId } = await params;
  await requireStaff("schedule", storeId);
  const sp = await searchParams;
  const store = await Store.findById(storeId).lean().catch(() => null);
  if (!store) notFound();
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const today = localDate(new Date(), tz);
  const ws = weekStartOf(isYmd(sp.week) ? sp.week : today);
  const data = await loadWeek(storeId, ws);
  const link = (w: string) => `/manage/schedule/${storeId}?week=${w}`;
  const thisWeek = weekStartOf(today);
  const weekNav = (
    <div className="flex flex-wrap items-center gap-2">
      <Link href={link(addDays(ws, -7))} className="rounded-xl bg-white p-2 ring-1 ring-[#f1e6c8] hover:bg-primary-light" aria-label="Tuần trước"><ChevronLeft size={18} /></Link>
      <span className="text-center font-bold sm:min-w-56">
        {viDate(ws)} – {viDate(addDays(ws, 6))}
        {weekLabel(ws, thisWeek, addDays) && (
          <span className="ml-1">
            (<WeekBadge label={weekLabel(ws, thisWeek, addDays)} />)
          </span>
        )}
      </span>
      <Link href={link(addDays(ws, 7))} className="rounded-xl bg-white p-2 ring-1 ring-[#f1e6c8] hover:bg-primary-light" aria-label="Tuần sau"><ChevronRight size={18} /></Link>
      {ws !== thisWeek && <Link href={link(thisWeek)} className="text-sm text-accent underline">Về tuần này</Link>}
    </div>
  );
  return (
    <>
      <PageTitle sub="Cam = nhân viên đăng ký chờ duyệt · ⚠ đỏ = thiếu người · xanh dương = hỗ trợ từ cơ sở khác. Thao tác của bạn được ghi lại cho admin cơ sở.">
        <Link href="/manage/schedule" className="text-sm font-normal underline">Xếp ca</Link> / {store.name}
      </PageTitle>
      {data.templates.length === 0 ? (
        <>
          {weekNav}
          <Alert tone="orange">Cơ sở chưa có ca mẫu – nhờ admin tạo ca.</Alert>
        </>
      ) : (
        <ScheduleBoard
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
          canRequest={ws >= addDays(thisWeek, 7)}
          isPast={addDays(ws, 6) < today}
          weekNav={weekNav}
        />
      )}
    </>
  );
}
