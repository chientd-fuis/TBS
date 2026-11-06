import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { ShiftAssignment, ShiftTemplate, Store, User } from "@/lib/models";
import { addDays, localDate, viDate, weekStartOf } from "@/lib/time";
import { Badge, Card, PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Xếp ca tự động – danh sách cơ sở (spec 3.2.1) */
export default async function ScheduleStores() {
  await requireAdmin();
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const ws = weekStartOf(localDate(new Date()));
  const next = addDays(ws, 7);
  const rows = await Promise.all(
    stores.map(async (s) => {
      const [staff, tpls, thisWeek, pendingNext, pendingAll] = await Promise.all([
        User.countDocuments({ storeId: s._id, status: "ACTIVE" }),
        ShiftTemplate.countDocuments({ storeId: s._id, active: true }),
        ShiftAssignment.countDocuments({ storeId: s._id, date: { $gte: ws, $lte: addDays(ws, 6) }, status: { $nin: ["PENDING", "REJECTED"] } }),
        ShiftAssignment.countDocuments({ storeId: s._id, date: { $gte: next, $lte: addDays(next, 6) }, status: "PENDING" }),
        ShiftAssignment.countDocuments({ storeId: s._id, date: { $gte: ws }, status: "PENDING" }),
      ]);
      return { s, staff, tpls, thisWeek, pendingNext, pendingAll };
    }),
  );
  return (
    <>
      <PageTitle sub={`Chọn cơ sở để xem & xếp lịch làm việc. Tuần này: ${viDate(ws)} – ${viDate(addDays(ws, 6))}`}>Xếp ca tự động</PageTitle>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ s, staff, tpls, thisWeek, pendingNext, pendingAll }) => (
          <Link key={String(s._id)} href={`/admin/schedule/${s._id}`} className="block transition hover:-translate-y-0.5">
            <Card title={s.name} actions={pendingAll > 0 ? <Badge tone="orange">{pendingAll} chờ duyệt</Badge> : <Badge tone="green">Không có chờ duyệt</Badge>}>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-xl bg-primary-light p-2"><p className="text-xs">Nhân viên</p><p className="text-xl font-bold">{staff}</p></div>
                <div className="rounded-xl bg-[#d9e6f6] p-2"><p className="text-xs">Ca tuần này</p><p className="text-xl font-bold">{thisWeek}</p></div>
                <div className="rounded-xl bg-[#ffe8d9] p-2"><p className="text-xs">Đăng ký tuần sau</p><p className="text-xl font-bold text-warn">{pendingNext}</p></div>
              </div>
              {tpls === 0 && <p className="mt-2 text-xs text-danger">Chưa có ca mẫu – tạo ở mục Ca làm việc.</p>}
              <p className="mt-2 text-right text-sm font-semibold text-accent">Mở lịch →</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
