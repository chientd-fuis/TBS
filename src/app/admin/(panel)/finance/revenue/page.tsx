import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { CashTransfer, DayRevenue, ShiftClosing, Store } from "@/lib/models";
import { closingSum, dayRevenueFromClosings, revenueDiff, shiftDeltas, type Revenue } from "@/lib/revenue";
import { localDate, localMonth, localTime, monthRange, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Badge, Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { deleteCashTransfer, saveCashTransfer } from "@/app/admin/actions/finance";
import { cn } from "@/lib/format";
import DailyRevenueTable, { type DayRow } from "./DailyRevenueTable";

export const dynamic = "force-dynamic";
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Doanh thu theo ngày = số chốt ca TỐI (chốt ca là luỹ kế: Chiều gồm Sáng, Tối = cả ngày).
 * Chưa chốt Tối → tạm tính theo ca chốt gần nhất. Bấm dòng → chi tiết 3 ca.
 */
export default async function DailyRevenuePage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  await requireOwner(); // doanh thu: chỉ Admin Tổng
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const { first, last } = monthRange(month);
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const shown = sp.store ? stores.filter((s) => String(s._id) === sp.store) : stores;
  const ids = shown.map((s) => s._id);
  const [closings, days, transfers] = await Promise.all([
    ShiftClosing.find({ workDate: { $gte: first, $lte: last }, storeId: { $in: ids }, "revenue.tm": { $ne: null } })
      .select("storeId workDate shiftName employeeName createdAt revenue staffTotal")
      .lean(),
    DayRevenue.find({ date: { $gte: first, $lte: last }, storeId: { $in: ids } }).select("storeId date sheet").lean(),
    CashTransfer.find({ month, storeId: { $in: ids } }).sort({ date: -1, createdAt: -1 }).lean(),
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
  // sổ quỹ: nộp tiền mặt vào TK (TM ↓ TK ↑) / rút TK ra tiền mặt (TK ↓ TM ↑) – tổng doanh thu không đổi
  const moves = (sid?: string) => {
    const list = transfers.filter((t) => !sid || String(t.storeId) === sid);
    return {
      deposit: list.filter((t) => t.kind === "DEPOSIT").reduce((s, t) => s + t.amount, 0),
      withdraw: list.filter((t) => t.kind === "WITHDRAW").reduce((s, t) => s + t.amount, 0),
    };
  };
  const cards = [
    ...shown.map((s) => ({ name: s.name, ...sumOf(rows.filter((r) => r.storeId === String(s._id))), ...moves(String(s._id)) })),
    ...(shown.length > 1 ? [{ name: "Cả chuỗi", ...sumOf(rows), ...moves() }] : []),
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
              {(c.deposit > 0 || c.withdraw > 0) && (
                <>
                  <dt className="pl-2 text-xs text-ink/60">Nộp TM → TK / Rút TK → TM</dt>
                  <dd className="text-right text-xs tabular-nums text-ink/60">{vnd(c.deposit)} / {vnd(c.withdraw)}</dd>
                  <dt className="pl-2 text-xs font-semibold text-[#1e40af]">TK sau chuyển</dt>
                  <dd className="text-right text-xs font-semibold tabular-nums text-[#1e40af]">{vnd(c.tk + c.deposit - c.withdraw)}</dd>
                  <dt className="pl-2 text-xs font-semibold text-[#1e40af]">TM sau chuyển</dt>
                  <dd className="text-right text-xs font-semibold tabular-nums text-[#1e40af]">{vnd(c.tm - c.deposit + c.withdraw)}</dd>
                </>
              )}
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

      <Card title={`Sổ quỹ tiền mặt / tài khoản – tháng ${month.slice(5)}/${month.slice(0, 4)}`}>
        <p className="mb-2 text-xs text-ink/60">
          Ghi khi <b>nộp tiền mặt vào tài khoản</b> hoặc <b>rút tài khoản ra tiền mặt</b>. Tổng doanh thu không đổi – chỉ chuyển giữa Tiền mặt và Tài khoản (xem dòng &quot;TM / TK sau chuyển&quot; ở trên).
        </p>
        <ActionForm action={saveCashTransfer} submitLabel="Ghi phiếu" successText="Đã ghi" className="flex flex-wrap items-end gap-2">
          <Field label="Cơ sở">
            <Select name="storeId" defaultValue={sp.store || String(stores[0]?._id ?? "")} className="!w-40">
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name.replace(/^TBS\s*/i, "")}</option>)}
            </Select>
          </Field>
          <Field label="Loại">
            <Select name="kind" defaultValue="DEPOSIT" className="!w-56">
              <option value="DEPOSIT">Nộp tiền mặt vào tài khoản</option>
              <option value="WITHDRAW">Rút tài khoản ra tiền mặt</option>
            </Select>
          </Field>
          <Field label="Ngày"><Input type="date" name="date" defaultValue={today.startsWith(month) ? today : last} required className="!w-40" /></Field>
          <Field label="Số tiền"><Input name="amount" inputMode="numeric" required placeholder="VD 5000000 hoặc 5tr" className="!w-36 text-right" /></Field>
          <Field label="Ghi chú"><Input name="note" placeholder="Tuỳ chọn" className="!w-48" /></Field>
        </ActionForm>
        {transfers.length > 0 && (
          <ul className="mt-3 divide-y divide-[#f1e6c8] text-sm">
            {transfers.map((t) => (
              <li key={String(t._id)} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-24 tabular-nums">{t.date.slice(8)}/{t.date.slice(5, 7)}</span>
                <span className="w-20 text-xs text-ink/60">{nameOf.get(String(t.storeId))}</span>
                <Badge tone={t.kind === "DEPOSIT" ? "blue" : "yellow"}>{t.kind === "DEPOSIT" ? "TM → TK" : "TK → TM"}</Badge>
                <b className="tabular-nums">{vnd(t.amount)}</b>
                <span className="min-w-0 flex-1 truncate text-xs text-ink/60">{t.note}</span>
                <ActionForm action={deleteCashTransfer} submitLabel="Xoá" variant="ghost" successText="" confirm={`Xoá phiếu ${vnd(t.amount)} ngày ${t.date.slice(8)}/${t.date.slice(5, 7)}?`}>
                  <input type="hidden" name="id" value={String(t._id)} />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
