import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { RevenuePickup, Store } from "@/lib/models";
import { loadDailyRevenueRows } from "@/lib/daily-revenue-rows";
import { localDate, localMonth } from "@/lib/time";
import { cn } from "@/lib/format";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, PageTitle } from "@/components/ui";
import DailyRevenueTable from "../finance/revenue/DailyRevenueTable";

export const dynamic = "force-dynamic";

/**
 * Menu Doanh thu: chỉ bảng chốt ca luỹ kế theo ngày (giống Tài chính → Doanh thu theo ngày, bỏ sổ quỹ + thẻ tổng từng cơ sở).
 * Quyền "revenue" (Admin Tổng luôn xem được). Có ẩn / hiện cột.
 */
export default async function RevenuePage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  const admin = await requirePerm("revenue");
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const shown = sp.store ? stores.filter((s) => String(s._id) === sp.store) : stores;
  const owner = admin.kind === "OWNER";
  const [{ rows }, picks] = await Promise.all([
    loadDailyRevenueRows({ month, stores, shown, owner }),
    RevenuePickup.find({ month, storeId: { $in: shown.map((s) => s._id) } }).lean(),
  ]);
  // đã lấy doanh thu (chưa đếm) – key giống dòng bảng: `${date}|${storeId}`
  const pickups = Object.fromEntries(picks.map((p) => [`${p.date}|${p.storeId}`, { by: p.by ?? "", at: (p.createdAt ?? new Date()).toISOString() }]));

  return (
    <>
      <PageTitle sub="Chốt ca luỹ kế theo ngày – bấm vào dòng để xem từng ca">Doanh thu</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker month={month} base="/admin/revenue" params={{ store: sp.store }} />
        <div className="flex flex-wrap gap-1.5 text-sm">
          {[{ id: "", name: "Tất cả" }, ...stores.map((s) => ({ id: String(s._id), name: s.name.replace(/^TBS\s*/i, "") }))].map((s) => (
            <Link
              key={s.id || "all"}
              href={`/admin/revenue?month=${month}${s.id ? `&store=${s.id}` : ""}`}
              className={cn(
                "rounded-lg px-3 py-1.5",
                (sp.store ?? "") === s.id ? "bg-secondary font-bold text-white" : "bg-white text-ink/70 ring-1 ring-[#f1e6c8] hover:bg-primary-light",
              )}
            >
              {s.name}
            </Link>
          ))}
        </div>
      </div>
      <Card>
        <p className="mb-3 text-xs text-ink/60">
          Chốt ca là số <b>luỹ kế</b>: ca Chiều đã gồm ca Sáng, ca Tối = cả ngày. Doanh thu thật = TK + TM + Shopee/Grab + Két; Âm/Dương = DT máy − DT thật. Doanh thu
          ngày = số chốt ca <b>Tối</b> (chưa chốt Tối → tạm tính theo ca chốt gần nhất).
        </p>
        <DailyRevenueTable rows={rows} today={localDate(new Date())} canEdit={owner} hideable pickups={pickups} />
      </Card>
    </>
  );
}
