import { CashTransfer, DayRevenue, ShiftClosing } from "./models";
import { closingSum, dayRevenueFromClosings, revenueDiff, shiftDeltas, type Revenue } from "./revenue";
import { localTime, monthRange, weekdayVi } from "./time";
import type { DayRow } from "@/app/admin/(panel)/finance/revenue/DailyRevenueTable";

type StoreLite = { _id: unknown; name: string; timezone?: string | null };

/** "2026-11-10" → "10/11 (T3)" · Chủ nhật → "(CN)" */
export function dayLabel(date: string) {
  const wd = weekdayVi(date).replace("Thứ ", "T").replace(/Chủ\s*Nhật/i, "CN");
  return `${date.slice(8)}/${date.slice(5, 7)} (${wd})`;
}

/**
 * Dòng bảng "Doanh thu theo ngày" (chốt ca luỹ kế) – dùng chung cho Tài chính → Doanh thu theo ngày và menu Doanh thu.
 * Doanh thu ngày = số chốt ca TỐI (chưa chốt Tối → tạm tính theo ca chốt gần nhất).
 * owner = false: phiếu nộp / rút cộng thẳng vào TK / TM của ngày ghi phiếu (admin khác chỉ thấy số SAU CÙNG).
 */
export async function loadDailyRevenueRows(opts: { month: string; stores: StoreLite[]; shown: StoreLite[]; owner: boolean }) {
  const { month, stores, shown, owner } = opts;
  const { first, last } = monthRange(month);
  const ids = shown.map((s) => s._id);
  const [closings, days, transfers] = await Promise.all([
    ShiftClosing.find({ workDate: { $gte: first, $lte: last }, storeId: { $in: ids }, "revenue.tm": { $ne: null } })
      .select("storeId workDate shiftName employeeName createdAt revenue staffTotal")
      .lean(),
    DayRevenue.find({ date: { $gte: first, $lte: last }, storeId: { $in: ids } }).select("storeId date sheet").lean(),
    // phiếu nộp TM → TK / rút TK → TM của cơ sở trong tháng (phiếu rút lãi / bổ sung vốn ở trang Sổ quỹ không tính ở đây)
    CashTransfer.find({ month, storeId: { $in: ids }, kind: { $in: ["DEPOSIT", "WITHDRAW"] } })
      .sort({ date: -1, createdAt: -1 })
      .lean(),
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
  const fig = (x: Partial<Revenue>) => ({
    tk: x.tk ?? 0,
    tm: x.tm ?? 0,
    sg: (x.grab ?? 0) + (x.shopee ?? 0),
    ket: x.cp ?? 0,
    thu: (x.tk ?? 0) + (x.tm ?? 0) + (x.grab ?? 0) + (x.shopee ?? 0) + (x.cp ?? 0), // DT thật = TK + TM + Grab + Shopee + két
    dtm: x.dt ?? null,
    diff: x.dt != null ? revenueDiff(x) : null,
  });
  const rows: DayRow[] = [...groups.entries()].map(([k, list]) => {
    const [date, storeId] = k.split("|");
    const deltas = shiftDeltas(list);
    const lastC = deltas[deltas.length - 1].closing;
    const r = dayRev.get(k) as unknown as Partial<Revenue>;
    const sheet = days.find((d) => d.date === date && String(d.storeId) === storeId)?.sheet;
    return {
      key: k,
      date,
      dateLabel: dayLabel(date),
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

  // Admin khác (quyền xem) chỉ thấy số SAU CÙNG: phiếu nộp / rút cộng thẳng vào TK / TM của ngày ghi phiếu.
  // Admin Tổng thấy số ban đầu theo chốt ca.
  if (!owner) {
    for (const t of transfers) {
      const r = rows.find((x) => x.date === t.date && x.storeId === String(t.storeId));
      if (r) {
        const net = t.kind === "DEPOSIT" ? t.amount : -t.amount; // TK tăng bao nhiêu
        r.tk += net;
        r.tm -= net;
      }
    }
  }
  return { rows, transfers, nameOf };
}
