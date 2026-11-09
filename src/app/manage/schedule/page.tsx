import Link from "next/link";
import { requireStaff } from "@/lib/staff-guard";
import { ShiftAssignment, Store } from "@/lib/models";
import { localDate, weekStartOf } from "@/lib/time";
import { Badge, Card, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Xếp ca – các cơ sở nhân viên được giao (cơ sở gốc + cơ sở thêm). */
export default async function ManageScheduleStores() {
  const { stores } = await requireStaff("schedule");
  const list = await Store.find({ _id: { $in: stores }, active: true }).sort({ name: 1 }).lean();
  const ws = weekStartOf(localDate(new Date()));
  const pending = await Promise.all(list.map((s) => ShiftAssignment.countDocuments({ storeId: s._id, date: { $gte: ws }, status: "PENDING" })));
  return (
    <>
      <PageTitle sub="Chọn cơ sở để xếp ca / duyệt đăng ký ca.">Xếp ca</PageTitle>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((s, i) => (
          <Link key={String(s._id)} href={`/manage/schedule/${s._id}`} className="block transition hover:-translate-y-0.5">
            <Card title={s.name} actions={pending[i] > 0 ? <Badge tone="orange">{pending[i]} chờ duyệt</Badge> : <Badge tone="green">Không có chờ duyệt</Badge>}>
              <p className="text-right text-sm font-semibold text-accent">Mở lịch →</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
