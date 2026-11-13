import { isValidObjectId } from "mongoose";
import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { ShiftClosing, Store } from "@/lib/models";
import { dayClosing, moneyExprItems } from "@/lib/revenue";
import { foldVi } from "@/lib/finance";
import { localMonth, monthRange, viDate, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Card, Empty, Select } from "@/components/ui";

export const dynamic = "force-dynamic";
const vnd = (n: number) => n.toLocaleString("vi-VN");

/** Chi phí trong ca: ô "Thu chi" nhân viên nhập khi chốt ca (tiền lấy từ két: sữa chua, ship, đá…). */
export default async function ShiftExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string }> }) {
  await requirePerm("finance.shiftExpenses");
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const { first, last } = monthRange(month);
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const short = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
  const q: Record<string, unknown> = { workDate: { $gte: first, $lte: last }, $or: [{ "revenue.cp": { $nin: [0, null] } }, { "revenueInput.cp": { $nin: ["", null] } }] };
  if (sp.store && isValidObjectId(sp.store)) q.storeId = sp.store; // link sai tham số → bỏ qua lọc (tránh lỗi 500)
  const all = await ShiftClosing.find(q).sort({ workDate: -1, createdAt: -1 }).select("storeId workDate shiftName employeeName revenue revenueInput createdAt").lean();
  // chốt ca LUỸ KẾ (ca Tối = cả ngày) → mỗi cơ sở mỗi ngày chỉ lấy lượt chốt cuối, tránh cộng trùng
  const groups = new Map<string, typeof all>();
  for (const c of all) {
    const k = `${c.workDate}|${c.storeId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(c);
  }
  const list = [...groups.values()].map((g) => dayClosing(g)!).sort((a, b) => b.workDate.localeCompare(a.workDate));

  const rows = list.map((c) => {
    const raw = c.revenueInput?.cp?.trim() || (c.revenue?.cp ? String(c.revenue.cp) : "");
    const items = moneyExprItems(raw);
    const total = c.revenue?.cp ?? items.reduce((s, i) => s + i.amount, 0);
    return { id: String(c._id), store: short.get(String(c.storeId)) ?? "?", storeId: String(c.storeId), date: c.workDate, shift: c.shiftName, who: c.employeeName, items, total };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  const byStore = stores.map((s) => ({ name: short.get(String(s._id))!, sum: rows.filter((r) => r.storeId === String(s._id)).reduce((a, r) => a + r.total, 0) })).filter((x) => x.sum);
  // gom theo mô tả (bỏ dấu, chữ thường) để thấy khoản nào chi nhiều
  const agg = new Map<string, { label: string; sum: number; n: number }>();
  for (const r of rows)
    for (const it of r.items) {
      const key = foldVi(it.label) || "_";
      const cur = agg.get(key) ?? { label: it.label || "(không ghi mô tả)", sum: 0, n: 0 };
      cur.sum += it.amount;
      cur.n++;
      agg.set(key, cur);
    }
  const top = [...agg.values()].sort((a, b) => b.sum - a.sum).slice(0, 12);
  const maxTop = Math.max(1, ...top.map((t) => t.sum));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} base="/admin/finance/shift-expenses" params={{ store: sp.store }} />
          <AutoFilterForm className="flex gap-2">
            <input type="hidden" name="month" value={month} />
            <Select name="store" defaultValue={sp.store ?? ""} className="w-auto">
              <option value="">Tất cả cơ sở</option>
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </AutoFilterForm>
        </div>
        <p className="mt-3 text-sm text-ink/70">
          Tổng chi trong ca: <b className="text-lg text-accent">{vnd(total)} đ</b> <span className="text-xs">({rows.length} ngày × cơ sở có thu chi)</span>
        </p>
        {byStore.length > 1 && <p className="text-xs text-ink/60">{byStore.map((b) => `${b.name}: ${vnd(b.sum)}`).join(" · ")}</p>}
        <p className="mt-1 text-xs text-ink/50">Nhân viên nhập ở ô &quot;Thu chi&quot; khi chốt ca (VD &quot;30k sữa chua + 20k ship&quot;). Chốt ca là số luỹ kế nên mỗi ngày lấy lượt chốt cuối (ca Tối). Tiền lấy từ két nên đã trừ thẳng vào lãi lỗ – không cần nhập bill lại.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Theo ngày (lượt chốt cuối)">
          {!rows.length ? (
            <Empty>Không có chi phí trong ca tháng này.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => (
                <li key={r.id} className="flex gap-3 py-2.5 text-sm">
                  <div className="w-24 shrink-0 text-xs text-ink/60">
                    {viDate(r.date).slice(0, 5)} {weekdayVi(r.date).replace("Thứ ", "T").replace("Chủ Nhật", "CN")}
                    <span className="block">{r.store}{r.shift ? ` · ${r.shift}` : ""}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <ul className="space-y-0.5">
                      {r.items.map((it, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{it.label || <i className="text-ink/50">không ghi mô tả</i>}</span>
                          <span className={`shrink-0 tabular-nums ${it.amount < 0 ? "text-good" : ""}`}>{vnd(it.amount)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-0.5 text-xs text-ink/50">{r.who}</p>
                  </div>
                  <div className="w-20 shrink-0 text-right font-semibold tabular-nums">{vnd(r.total)}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink/50">Sửa số liệu: vào <Link href="/admin/closings" className="underline">Chốt ca</Link>.</p>
        </Card>

        <Card title="Chi nhiều nhất">
          {!top.length ? (
            <Empty>–</Empty>
          ) : (
            <ul className="space-y-2">
              {top.map((t) => (
                <li key={t.label} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{t.label} <span className="text-ink/50">×{t.n}</span></span>
                    <span className="tabular-nums">{vnd(t.sum)}</span>
                  </div>
                  <span className="mt-0.5 block h-2 overflow-hidden rounded-full bg-mute-bg">
                    <span className="block h-full rounded-full bg-secondary" style={{ width: `${(Math.max(0, t.sum) / maxTop) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
