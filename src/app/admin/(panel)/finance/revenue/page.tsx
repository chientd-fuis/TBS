import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { DayRevenue, ShiftClosing, Store } from "@/lib/models";
import { closingSum, dayRevenueFromClosings, revenueDiff, shiftDeltas, type Revenue } from "@/lib/revenue";
import { localDate, localMonth, localTime, monthRange, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Card } from "@/components/ui";
import { cn } from "@/lib/format";
import DailyRevenueTable, { type DayRow } from "./DailyRevenueTable";

export const dynamic = "force-dynamic";
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Doanh thu theo ngày = số chốt ca TỐI (chốt ca là luỹ kế: Chiều gồm Sáng, Tối = cả ngày).
 * Chưa chốt Tối → tạm tính theo ca chốt gần nhất. Bấm dòng → chi tiết 3 ca.
 */
export default async function DailyRevenuePage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  await requireAdmin();
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const { first, last } = monthRange(month);
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const shown = sp.store ? stores.filter((s) => String(s._id) === sp.store) : stores;
  const ids = shown.map((s) => s._id);
  const [closings, days] = await Promise.all([
    ShiftClosing.find({ workDate: { $gte: first, $lte: last }, storeId: { $in: ids }, "revenue.tm": { $ne: null } })
      .select("storeId workDate shiftName employeeName createdAt revenue staffTotal")
      .lean(),
    DayRevenue.find({ date: { $gte: first, $lte: last }, storeId: { $in: ids } }).select("storeId date sheet").lean(),
  ]);
  const tzOf = new Map(stores.map((s) => [String(s._id), s.timezone || "Asia/Ho_Chi_Minh"]));
  const nameOf = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));

  // gom theo ngày × cơ sở
  const groups = new Map<string, typeof closings>();
  for (const c of closings) {
    const k = `${c.workDate}|${c.storeId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  // số ngày lấy từ CÙNG hàm với Lãi lỗ (dayRevenueFromClosings) → tổng luôn khớp
  const dayRev = new Map(dayRevenueFromClosings(closings).map((d) => [`${d.date}|${d.storeId}`, d]));
  const rows: DayRow[] = [...groups.entries()].map(([k, list]) => {
    const [date, storeId] = k.split("|");
    const deltas = shiftDeltas(list);
    const lastC = deltas[deltas.length - 1].closing;
    const r = dayRev.get(k) as unknown as Partial<Revenue>;
    const sheet = days.find((d) => d.date === date && String(d.storeId) === storeId)?.sheet;
    const fig = (x: Partial<Revenue>) => ({
      tk: x.tk ?? 0,
      tm: x.tm ?? 0,
      sg: (x.grab ?? 0) + (x.shopee ?? 0),
      ket: x.cp ?? 0,
      thu: (x.tk ?? 0) + (x.tm ?? 0) + (x.grab ?? 0) + (x.shopee ?? 0) + (x.cp ?? 0), // DT thật = TK + TM + Grab + Shopee + két
      dtm: x.dt ?? null,
      diff: x.dt != null ? revenueDiff(x) : null,
    });
    return {
      key: k,
      date,
      dateLabel: `${weekdayVi(date).replace("Thứ ", "T").replace("Chủ Nhật", "CN")} ${date.slice(8)}/${date.slice(5, 7)}`,
      storeId,
      storeName: nameOf.get(storeId) ?? "?",
      ...fig(r),
      done: ["Sáng", "Chiều", "Tối"].filter((n) => list.some((c) => c.shiftName === n)),
      final: lastC.shiftName === "Tối",
      sheet: sheet ? { status: sheet.status ?? "PENDING", error: sheet.error ?? "", range: sheet.range ?? "" } : null,
      shifts: deltas.map(({ closing: c, own }) => {
        const cr = (c.revenue ?? {}) as Partial<Revenue>;
        const sum = closingSum(cr);
        return {
          name: c.shiftName ?? "Ngoài ca",
          at: c.createdAt ? localTime(new Date(c.createdAt), tzOf.get(storeId)).slice(0, 5) : "",
          who: c.employeeName ?? "",
          ...fig(cr),
          own: own.tm + own.tk + own.grab + own.shopee + own.cp,
          staffTotal: c.staffTotal ?? null,
          totalOk: c.staffTotal == null ? null : c.staffTotal === sum,
        };
      }),
    };
  });
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.storeName.localeCompare(b.storeName));

  // tổng hợp theo cơ sở
  const sumOf = (rs: DayRow[]) => ({
    thu: rs.reduce((s, r) => s + r.thu, 0),
    tk: rs.reduce((s, r) => s + r.tk, 0),
    tm: rs.reduce((s, r) => s + r.tm, 0),
    sg: rs.reduce((s, r) => s + r.sg, 0),
    ket: rs.reduce((s, r) => s + r.ket, 0),
    dtm: rs.reduce((s, r) => s + (r.dtm ?? 0), 0),
    diff: rs.reduce((s, r) => s + (r.diff ?? 0), 0),
    days: rs.length,
    open: rs.filter((r) => !r.final).length,
  });
  const cards = [
    ...shown.map((s) => ({ name: s.name, ...sumOf(rows.filter((r) => r.storeId === String(s._id))) })),
    ...(shown.length > 1 ? [{ name: "Cả chuỗi", ...sumOf(rows) }] : []),
  ];
  const today = localDate(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker month={month} base="/admin/finance/revenue" params={{ store: sp.store }} />
        <div className="flex flex-wrap gap-1.5 text-sm">
          {[{ id: "", name: "Tất cả" }, ...stores.map((s) => ({ id: String(s._id), name: s.name.replace(/^TBS\s*/i, "") }))].map((s) => (
            <Link
              key={s.id || "all"}
              href={`/admin/finance/revenue?month=${month}${s.id ? `&store=${s.id}` : ""}`}
              className={cn("rounded-lg px-3 py-1.5", (sp.store ?? "") === s.id ? "bg-secondary font-bold text-white" : "bg-white text-ink/70 ring-1 ring-[#f1e6c8] hover:bg-primary-light")}
            >
              {s.name}
            </Link>
          ))}
        </div>
      </div>

      <div className={cn("grid gap-3", cards.length > 2 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2")}>
        {cards.map((c) => (
          <Card key={c.name} className={cn("p-3", c.name === "Cả chuỗi" && "ring-2 ring-secondary/40")}>
            <p className="text-sm font-bold text-accent">{c.name}</p>
            <p className="mt-1 text-xs text-ink/60">Tổng doanh thu thật</p>
            <p className="text-xl font-bold tabular-nums">{vnd(c.thu)}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-ink/60">Tài khoản</dt><dd className="text-right tabular-nums">{vnd(c.tk)}</dd>
              <dt className="text-ink/60">Tiền mặt</dt><dd className="text-right tabular-nums">{vnd(c.tm)}</dd>
              <dt className="text-ink/60">Shopee / Grab</dt><dd className="text-right tabular-nums">{vnd(c.sg)}</dd>
              <dt className="text-ink/60">Chi phí két</dt><dd className="text-right tabular-nums text-ink/60">{vnd(c.ket)}</dd>
              <dt className="text-ink/60">DT máy</dt><dd className="text-right tabular-nums">{vnd(c.dtm)}</dd>
              <dt className="text-ink/60">Âm / Dương</dt>
              <dd className={cn("text-right font-semibold tabular-nums", c.diff ? "text-danger" : "text-secondary-dark")}>{c.diff > 0 ? "+" : ""}{vnd(c.diff)}</dd>
            </dl>
            <p className="mt-1 text-[11px] text-ink/50">{c.days} ngày có chốt ca{c.open ? ` · ${c.open} ngày chưa chốt Tối` : ""}</p>
          </Card>
        ))}
      </div>

      <Card>
        <p className="mb-3 text-xs text-ink/60">
          Chốt ca là số <b>luỹ kế</b>: ca Chiều đã gồm ca Sáng, ca Tối = cả ngày. Doanh thu thật = TK + TM + Shopee/Grab + Két; Âm/Dương = DT máy − DT thật. Doanh thu ngày = số chốt ca <b>Tối</b> (chưa chốt Tối → tạm tính theo ca chốt gần nhất).
          Bấm vào dòng để xem 3 ca.
        </p>
        <DailyRevenueTable rows={rows} today={today} />
      </Card>
    </div>
  );
}
