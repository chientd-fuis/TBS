import { isValidObjectId } from "mongoose";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { GoodsReceipt, Store } from "@/lib/models";
import { getGoodsItems, stockEnabled } from "@/lib/goods-server";
import { qtyVi, usageReport, type GoodsLine, type UsageRec, type UsageRow } from "@/lib/goods";
import { loadDayRevenue } from "@/lib/finance-data";
import { vnd } from "@/lib/format";
import { addDays, localDate, localMonth, monthRange, prevMonth, viDate } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Card, Empty, PageTitle, Select } from "@/components/ui";
import GoodsTabs from "../GoodsTabs";

export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%` : "—");
const q = (n: number, unit: string) => `${qtyVi(n)}${unit ? ` ${unit}` : ""}`;

/**
 * Tổng hợp tiêu thụ nguyên liệu tháng × giá nhập → tiền nguyên liệu từng cơ sở, so với doanh thu (Admin Tổng) để soi thất thoát.
 * Tồn kho bật + có 2 lần kiểm (trước tháng & trong tháng): tiêu thụ = tồn đầu + nhập − tồn cuối; không thì theo số nhập.
 */
export default async function GoodsReportPage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  const admin = await requirePerm("goods");
  await connectDB();
  const sp = await searchParams;
  const today = localDate(new Date());
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const stores = (await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean()).map((s) => ({ id: String(s._id), name: s.name, short: s.name.replace(/^TBS\s*/i, "") }));
  const store = sp.store && isValidObjectId(sp.store) ? sp.store : "";
  const shown = store ? stores.filter((s) => s.id === store) : stores;
  const items = await getGoodsItems();
  const useStock = await stockEnabled();
  const owner = admin.kind === "OWNER"; // doanh thu chỉ Admin Tổng xem

  const period = (m: string) => {
    const { first, last } = monthRange(m);
    return { from: first, to: last < today ? last : today };
  };
  const cur = period(month);
  const prev = period(prevMonth(month));
  // lấy rộng về trước 90 ngày để có lần kiểm kho trước tháng (tồn đầu)
  const docs = await GoodsReceipt.find({ date: { $gte: addDays(prev.from, -90), $lte: cur.to }, storeId: { $in: shown.map((s) => s.id) } })
    .select("kind storeId date createdAt items")
    .lean();
  const recsOf = (sid: string): UsageRec[] =>
    docs
      .filter((d) => String(d.storeId) === sid)
      .map((d) => ({ kind: d.kind === "STOCK" ? "STOCK" : "RECEIVE", date: d.date, at: new Date(d.createdAt ?? 0).getTime(), lines: (d.items ?? []) as GoodsLine[] }));
  const calc = (sid: string, p: { from: string; to: string }) => usageReport({ ...p, items, recs: recsOf(sid), useStock });
  const total = (rows: UsageRow[]) => rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const totalIn = (rows: UsageRow[]) => rows.reduce((s, r) => s + (r.receivedValue ?? 0), 0);

  const per = shown.map((s) => {
    const rows = calc(s.id, cur);
    const before = calc(s.id, prev);
    return { s, rows, value: total(rows), prevValue: total(before), inValue: totalIn(rows), prevIn: totalIn(before), noPrice: rows.filter((r) => r.value == null).length, skipped: rows.reduce((n, r) => n + r.skipped, 0), stockRows: rows.filter((r) => r.mode === "stock").length };
  });
  // doanh thu thật (TM + TK + Grab + Shopee + két) – chỉ Admin Tổng
  const revOf = async (p: { from: string; to: string }) => {
    const m = new Map<string, number>();
    if (!owner) return m;
    for (const r of await loadDayRevenue(p.from, p.to, shown.map((s) => s.id))) m.set(r.storeId, (m.get(r.storeId) ?? 0) + r.tm + r.tk + r.grab + r.shopee + r.cp);
    return m;
  };
  const [rev, revPrev] = await Promise.all([revOf(cur), revOf(prev)]);

  // chi tiết món: 1 cơ sở → đầy đủ cột; tất cả → mỗi cơ sở 1 cột
  const names = [...new Set(per.flatMap((p) => p.rows.map((r) => r.name)))].sort((a, b) => items.findIndex((i) => i.name === a) - items.findIndex((i) => i.name === b));
  const unitOf = new Map(items.map((i) => [i.name, i.unit]));
  const sumValue = per.reduce((s, p) => s + p.value, 0);
  const sumRev = [...rev.values()].reduce((s, v) => s + v, 0);

  return (
    <>
      <PageTitle sub="Tổng hàng nhập từng cơ sở (số lượng × giá nhập theo ngày) · tiêu thụ nguyên liệu; so % trên doanh thu giữa các cơ sở / tháng trước để soi thất thoát">Tổng hợp hàng nhập</PageTitle>
      <GoodsTabs active="report" stockOn={useStock} />
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} base="/admin/goods/report" params={{ store: store || undefined }} />
          <AutoFilterForm className="flex flex-wrap gap-2">
            <input type="hidden" name="month" value={month} />
            <Select name="store" defaultValue={store} className="w-auto">
              <option value="">Tất cả cơ sở</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </AutoFilterForm>
          <span className="text-xs text-ink/60">
            {viDate(cur.from)} → {viDate(cur.to)} · {useStock ? "tính theo tồn kho (đủ 2 lần kiểm) hoặc theo số nhập" : "tính theo số nhập (Tồn kho đang tắt)"}
          </span>
        </div>
      </Card>

      <Card title="Theo cơ sở" className="mt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#f1e6c8] text-left text-xs text-ink/60">
                <th className="py-1.5 pr-3">Cơ sở</th>
                <th className="px-2 text-right">Tiền hàng nhập</th>
                <th className="px-2 text-right">Tháng trước</th>
                <th className="px-2 text-right">Tiền NL tiêu thụ</th>
                <th className="px-2 text-right">Tháng trước</th>
                {owner && <th className="px-2 text-right">Doanh thu</th>}
                {owner && <th className="px-2 text-right">% NL / DT</th>}
                {owner && <th className="px-2 text-right">Tháng trước</th>}
                <th className="pl-2">Lưu ý</th>
              </tr>
            </thead>
            <tbody>
              {per.map((p) => (
                <tr key={p.s.id} className="border-b border-[#f1e6c8]/60">
                  <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{p.s.short}</td>
                  <td className="px-2 text-right font-bold tabular-nums whitespace-nowrap">{vnd(p.inValue)}</td>
                  <td className="px-2 text-right tabular-nums text-ink/60 whitespace-nowrap">{vnd(p.prevIn)}</td>
                  <td className="px-2 text-right font-bold tabular-nums whitespace-nowrap">{vnd(p.value)}</td>
                  <td className="px-2 text-right tabular-nums text-ink/60 whitespace-nowrap">{vnd(p.prevValue)}</td>
                  {owner && <td className="px-2 text-right tabular-nums whitespace-nowrap">{vnd(rev.get(p.s.id) ?? 0)}</td>}
                  {owner && <td className="px-2 text-right font-bold tabular-nums">{pct(p.value, rev.get(p.s.id) ?? 0)}</td>}
                  {owner && <td className="px-2 text-right tabular-nums text-ink/60">{pct(p.prevValue, revPrev.get(p.s.id) ?? 0)}</td>}
                  <td className="pl-2 text-xs text-warn">
                    {[p.noPrice && `${p.noPrice} món chưa có giá`, p.skipped && `${p.skipped} dòng khác đơn vị`, useStock && p.stockRows > 0 && `${p.stockRows} món tính theo tồn kho`].filter(Boolean).join(" · ")}
                  </td>
                </tr>
              ))}
              {per.length > 1 && (
                <tr className="font-bold">
                  <td className="py-1.5 pr-3">Tổng</td>
                  <td className="px-2 text-right tabular-nums">{vnd(per.reduce((s, p) => s + p.inValue, 0))}</td>
                  <td className="px-2 text-right tabular-nums text-ink/60">{vnd(per.reduce((s, p) => s + p.prevIn, 0))}</td>
                  <td className="px-2 text-right tabular-nums">{vnd(sumValue)}</td>
                  <td className="px-2 text-right tabular-nums text-ink/60">{vnd(per.reduce((s, p) => s + p.prevValue, 0))}</td>
                  {owner && <td className="px-2 text-right tabular-nums">{vnd(sumRev)}</td>}
                  {owner && <td className="px-2 text-right tabular-nums">{pct(sumValue, sumRev)}</td>}
                  {owner && <td />}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink/60">
          {useStock ? "Tiền NL tiêu thụ = (tồn đầu + nhập − tồn cuối) × giá." : "Tồn kho đang tắt → tiền NL tiêu thụ = tiền hàng nhập."} Soi thất thoát: cơ sở có <b>% nguyên liệu / doanh thu</b> cao bất thường so với cơ sở khác hoặc so với tháng trước → nghi hao hụt / mất hàng / nhập thiếu báo cáo.
          {useStock && " Tiêu thụ âm = kiểm kho sai hoặc thiếu phiếu nhận."}
        </p>
      </Card>

      <Card title={shown.length === 1 ? "Chi tiết từng món" : "Hàng nhập từng món (số lượng · tiền)"} className="mt-3">
        {!names.length ? (
          <Empty>Chưa có số nhận hàng trong tháng.</Empty>
        ) : shown.length === 1 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f1e6c8] text-left text-xs text-ink/60">
                  <th className="py-1.5 pr-3">Món</th>
                  {useStock && <th className="px-2 text-right">Tồn đầu</th>}
                  <th className="px-2 text-right">Nhập trong tháng</th>
                  <th className="px-2 text-right">Tiền nhập</th>
                  {useStock && <th className="px-2 text-right">Tồn cuối</th>}
                  <th className="px-2 text-right">Tiêu thụ</th>
                  <th className="px-2 text-right">Giá hiện tại</th>
                  <th className="pl-2 text-right">Tiền tiêu thụ</th>
                </tr>
              </thead>
              <tbody>
                {per[0].rows.map((r) => (
                  <tr key={r.name} className="border-b border-[#f1e6c8]/60">
                    <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">
                      {r.name}
                      {r.skipped > 0 && <span className="ml-1 text-xs font-normal text-warn">({r.skipped} dòng khác ĐV)</span>}
                    </td>
                    {useStock && <td className="px-2 text-right tabular-nums whitespace-nowrap" title={r.open ? `kiểm ${viDate(r.open.date)}` : undefined}>{r.open ? q(r.open.qty, r.unit) : "—"}</td>}
                    <td className="px-2 text-right tabular-nums whitespace-nowrap">{q(r.monthReceived, r.unit)}</td>
                    <td className="px-2 text-right tabular-nums whitespace-nowrap">{r.receivedValue != null ? vnd(r.receivedValue) : <span className="text-warn">chưa có giá</span>}</td>
                    {useStock && <td className="px-2 text-right tabular-nums whitespace-nowrap" title={r.close ? `kiểm ${viDate(r.close.date)}` : undefined}>{r.close ? q(r.close.qty, r.unit) : "—"}</td>}
                    <td className={`px-2 text-right font-semibold tabular-nums whitespace-nowrap ${r.usage < 0 ? "text-danger" : ""}`}>{q(r.usage, r.unit)}</td>
                    <td className="px-2 text-right tabular-nums text-ink/60 whitespace-nowrap">{r.price != null ? vnd(r.price) : <span className="text-warn">chưa có</span>}</td>
                    <td className="pl-2 text-right font-bold tabular-nums whitespace-nowrap">{r.value != null ? vnd(r.value) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#f1e6c8] text-left text-xs text-ink/60">
                  <th className="py-1.5 pr-3">Món</th>
                  {per.map((p) => <th key={p.s.id} className="px-2 text-right whitespace-nowrap">{p.s.short}</th>)}
                  <th className="pl-2 text-right">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {names.map((n) => {
                  const cells = per.map((p) => p.rows.find((r) => r.name === n));
                  const sq = cells.reduce((s, r) => s + (r?.monthReceived ?? 0), 0);
                  const sv = cells.reduce((s, r) => s + (r?.receivedValue ?? 0), 0);
                  return (
                    <tr key={n} className="border-b border-[#f1e6c8]/60">
                      <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{n}</td>
                      {cells.map((r, i) => (
                        <td key={per[i].s.id} className="px-2 text-right tabular-nums whitespace-nowrap">
                          {r ? (
                            <>
                              {q(r.monthReceived, r.unit)}
                              <span className="block text-xs text-ink/60">{r.receivedValue != null ? vnd(r.receivedValue) : "chưa có giá"}</span>
                            </>
                          ) : (
                            ""
                          )}
                        </td>
                      ))}
                      <td className="pl-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {q(Math.round(sq * 1000) / 1000, unitOf.get(n) ?? "")}
                        <span className="block text-xs">{vnd(sv)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {items.some((i) => i.active && !i.prices.length) && (
          <Alert tone="yellow">
            Có món chưa nhập giá → chưa tính tiền. Thêm giá ở tab <a href="/admin/goods/items" className="underline">Nguyên liệu &amp; giá</a>.
          </Alert>
        )}
      </Card>
    </>
  );
}
