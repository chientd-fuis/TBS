import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { Store } from "@/lib/models";
import { localDate, localMonth } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, PageTitle } from "@/components/ui";
import { cn } from "@/lib/format";
import MonthShiftBoard from "../attendance/MonthShiftBoard";
import { loadMonthBoard } from "../attendance/month-board-data";

export const dynamic = "force-dynamic";

/** Lịch làm việc: bảng ca × ngày cả tháng của 1 cơ sở – ai làm ca nào, đã chấm công / bỏ ca / đang trong ca. */
export default async function WorkSchedulePage({ searchParams }: { searchParams: Promise<{ store?: string; month?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find({ active: { $ne: false } }).sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : localMonth(new Date(), tz);
  const board = store ? await loadMonthBoard(String(store._id), month, tz, stores) : null;

  return (
    <>
      <PageTitle sub="Bảng ca × ngày cả tháng. Bấm tên để xem bảng chấm công chi tiết của nhân viên.">Lịch làm việc</PageTitle>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5 text-sm">
            {stores.map((s) => (
              <Link
                key={String(s._id)}
                href={`/admin/work-schedule?store=${s._id}&month=${month}`}
                className={cn("rounded-lg px-3 py-1.5", String(s._id) === String(store?._id) ? "bg-secondary font-bold text-white" : "bg-white text-ink/70 ring-1 ring-[#f1e6c8] hover:bg-primary-light")}
              >
                {s.name}
              </Link>
            ))}
          </div>
          <div className="ml-auto">
            <MonthPicker month={month} base="/admin/work-schedule" params={{ store: String(store?._id ?? "") }} />
          </div>
        </div>
      </Card>
      {!store ? (
        <p className="text-sm text-ink/60">Chưa có cơ sở.</p>
      ) : (
        board && (
          <Card title={`${store.name} – tháng ${month.slice(5)}/${month.slice(0, 4)}`}>
            {board.templates.length ? (
              <MonthShiftBoard month={month} today={localDate(new Date(), tz)} {...board} />
            ) : (
              <p className="text-sm text-ink/60">Cơ sở chưa có ca làm việc.</p>
            )}
          </Card>
        )
      )}
    </>
  );
}
