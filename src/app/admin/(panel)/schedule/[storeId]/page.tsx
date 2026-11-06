import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/guards";
import { Store } from "@/lib/models";
import { loadWeek } from "@/lib/schedule-data";
import { addDays, isYmd, localDate, viDate, weekStartOf } from "@/lib/time";
import { Alert, LinkButton, PageTitle } from "@/components/ui";
import ScheduleBoard from "./ScheduleBoard";

export const dynamic = "force-dynamic";

/** Lịch làm việc 1 cơ sở theo tuần – theo mẫu bảng S/C/T × Thứ 2…CN */
export default async function StoreSchedule({ params, searchParams }: { params: Promise<{ storeId: string }>; searchParams: Promise<{ week?: string }> }) {
  await requireAdmin();
  const { storeId } = await params;
  const sp = await searchParams;
  const store = await Store.findById(storeId).lean().catch(() => null);
  if (!store) notFound();
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const today = localDate(new Date(), tz);
  const ws = weekStartOf(isYmd(sp.week) ? sp.week : today);
  const data = await loadWeek(storeId, ws);
  const link = (w: string) => `/admin/schedule/${storeId}?week=${w}`;
  const thisWeek = weekStartOf(today);
  return (
    <>
      <PageTitle sub="Cam = nhân viên đăng ký chờ duyệt · đỏ = thiếu người · vàng = ít người">
        <Link href="/admin/schedule" className="text-sm font-normal underline">Xếp ca</Link> / {store.name}
      </PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={link(addDays(ws, -7))} className="rounded-xl bg-white p-2 ring-1 ring-[#f1e6c8] hover:bg-primary-light" aria-label="Tuần trước"><ChevronLeft size={18} /></Link>
        <span className="min-w-56 text-center font-bold">
          {viDate(ws)} – {viDate(addDays(ws, 6))}
          {ws === thisWeek && <span className="ml-1 text-xs font-normal text-secondary-dark">(tuần này)</span>}
          {ws === addDays(thisWeek, 7) && <span className="ml-1 text-xs font-normal text-warn">(tuần sau)</span>}
        </span>
        <Link href={link(addDays(ws, 7))} className="rounded-xl bg-white p-2 ring-1 ring-[#f1e6c8] hover:bg-primary-light" aria-label="Tuần sau"><ChevronRight size={18} /></Link>
        {ws !== thisWeek && <Link href={link(thisWeek)} className="text-sm text-accent underline">Về tuần này</Link>}
        <div className="ml-auto flex gap-2">
          <LinkButton variant="outline" href={`/admin/shifts?store=${storeId}&week=${ws}`}>Ca mẫu & xếp hàng loạt</LinkButton>
          <LinkButton variant="outline" href={`/api/admin/export?type=lichca&store=${storeId}&from=${ws.slice(0, 7)}&to=${addDays(ws, 6).slice(0, 7)}`}>Xuất Excel</LinkButton>
        </div>
      </div>
      {data.templates.length === 0 ? (
        <Alert tone="orange">
          Cơ sở chưa có ca mẫu. <Link className="underline" href={`/admin/shifts?store=${storeId}`}>Tạo ca (VD: S 08:00–13:00, C 13:00–18:00, T 18:00–23:00)</Link>
        </Alert>
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
          isPast={addDays(ws, 6) < today}
        />
      )}
    </>
  );
}
