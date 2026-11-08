import type { StoreLite } from "@/lib/finance-data";
import { CATEGORY_LABEL, COST_KEYS, COST_LABEL, margin, type PnlLine, type PnlResult } from "@/lib/finance";
import { viDate, viMonth, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, Empty } from "@/components/ui";
import { cn } from "@/lib/format";

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const signed = (n: number) => `${n < 0 ? "−" : ""}${vnd(Math.abs(n))}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const profitCls = (n: number) => (n > 0 ? "text-secondary-dark" : n < 0 ? "text-danger" : "text-ink/50");

function Delta({ now, prev, invert = false }: { now: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-ink/40">–</span>;
  const d = (now - prev) / Math.abs(prev);
  const good = invert ? d <= 0 : d >= 0;
  return (
    <span className={cn("text-xs font-semibold", good ? "text-secondary-dark" : "text-danger")}>
      {d >= 0 ? "▲" : "▼"} {pct(Math.abs(d))} <span className="font-normal text-ink/50">so kỳ trước</span>
    </span>
  );
}

export default function PnlView({
  month,
  first,
  to,
  prevFirst,
  prevTo,
  stores,
  pnl,
  dates,
  prev,
}: {
  month: string;
  first: string;
  to: string;
  prevFirst: string;
  prevTo: string;
  stores: StoreLite[];
  pnl: PnlResult;
  dates: string[];
  prev: PnlResult;
}) {
  const t = pnl.total;
  const pt = prev.total;

  const tiles: { label: string; value: number; prev: number; invert?: boolean; extra?: string; cls?: string }[] = [
    { label: "Doanh thu", value: t.revenue, prev: pt.revenue },
    { label: "Chi phí", value: t.cost, prev: pt.cost, invert: true },
    { label: "Lợi nhuận (ước tính)", value: t.profit, prev: pt.profit, cls: profitCls(t.profit) },
  ];
  const rows: { label: string; get: (l: PnlLine) => number; bold?: boolean; neg?: boolean }[] = [
    { label: "Doanh thu", get: (l) => l.revenue, bold: true },
    ...COST_KEYS.map((k) => ({ label: `− ${COST_LABEL[k]}`, get: (l: PnlLine) => l[k], neg: true })),
    { label: "Tổng chi phí", get: (l) => l.cost, bold: true },
    { label: "Lợi nhuận", get: (l) => l.profit, bold: true },
  ];
  const costParts: [string, number][] = [
    ["Lương", t.labor],
    ["Phí sàn", t.platformFee],
    ["Chi phí trong ca (két)", t.cashbox],
    ...Object.entries(pnl.byCategory).map(([k, v]) => [CATEGORY_LABEL[k] ?? k, v] as [string, number]),
  ];
  const parts = costParts.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const maxPart = parts[0]?.[1] ?? 1;
  const shownDates = [...dates].reverse();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} base="/admin/finance" />
        <span className="text-xs text-ink/60">
          {viDate(first)} – {viDate(to)} · so với {viDate(prevFirst)} – {viDate(prevTo)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((x) => (
          <Card key={x.label} className="p-3">
            <p className="text-xs text-ink/60">{x.label}</p>
            <p className={cn("text-xl font-bold tabular-nums", x.cls)}>{signed(x.value)}</p>
            <Delta now={x.value} prev={x.prev} invert={x.invert} />
          </Card>
        ))}
        <Card className="p-3">
          <p className="text-xs text-ink/60">Biên lợi nhuận</p>
          <p className={cn("text-xl font-bold tabular-nums", profitCls(t.profit))}>{pct(margin(t))}</p>
          <span className="text-xs text-ink/50">kỳ trước {pct(margin(pt))}</span>
        </Card>
      </div>

      <Card title="Theo cơ sở">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
                <th className="py-2 text-left font-semibold">Khoản</th>
                {stores.map((s) => <th key={s._id} className="py-2 text-right font-semibold">{s.short}</th>)}
                <th className="py-2 text-right font-semibold">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className={cn("border-b border-[#f8f1dd]", r.bold && "font-bold", r.label === "Lợi nhuận" && "bg-cream")}>
                  <td className={cn("py-1.5 pr-2", r.neg && "pl-2 text-ink/70")}>{r.label}</td>
                  {[...stores.map((s) => pnl.byStore[s._id]), t].map((l, i) => {
                    const v = r.get(l);
                    return (
                      <td key={i} className={cn("py-1.5 text-right tabular-nums", r.label === "Lợi nhuận" && profitCls(v), r.neg && !v && "text-ink/30")}>
                        {signed(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="text-xs text-ink/60">
                <td className="py-1.5">Biên lợi nhuận</td>
                {[...stores.map((s) => pnl.byStore[s._id]), t].map((l, i) => <td key={i} className="py-1.5 text-right">{pct(margin(l))}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card title="Lợi nhuận theo ngày">
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
                  <th className="py-2 text-left font-semibold">Ngày</th>
                  {stores.map((s) => <th key={s._id} className="py-2 text-right font-semibold">{s.short}</th>)}
                  <th className="py-2 text-right font-semibold">Tổng</th>
                </tr>
              </thead>
              <tbody>
                {shownDates.map((d) => (
                  <tr key={d} className="border-b border-[#f8f1dd]">
                    <td className="py-1.5 whitespace-nowrap">
                      {viDate(d).slice(0, 5)} <span className="text-xs text-ink/50">{weekdayVi(d).replace("Thứ ", "T").replace("Chủ Nhật", "CN")}</span>
                    </td>
                    {[...stores.map((s) => pnl.cells[`${d}|${s._id}`]), pnl.byDate[d]].map((l, i) => (
                      <td key={i} className="py-1.5 text-right tabular-nums">
                        <span className={cn("font-semibold", profitCls(l.profit))}>{l.revenue || l.cost ? signed(l.profit) : "–"}</span>
                        {l.revenue > 0 && <span className="block text-[10px] text-ink/50">DT {vnd(l.revenue)}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Chi phí theo loại">
          {!parts.length ? (
            <Empty>Chưa có chi phí.</Empty>
          ) : (
            <ul className="space-y-2">
              {parts.map(([k, v]) => (
                <li key={k} className="text-xs">
                  <div className="flex justify-between">
                    <span>{k}</span>
                    <span className="tabular-nums">{vnd(v)} <span className="text-ink/50">({t.revenue ? pct(v / t.revenue) : "–"} DT)</span></span>
                  </div>
                  <span className="mt-0.5 block h-2 overflow-hidden rounded-full bg-gray-100">
                    <span className="block h-full rounded-full bg-accent/70" style={{ width: `${(v / maxPart) * 100}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-xs text-ink/60">
        Lợi nhuận là <b>ước tính</b> T{viMonth(month)}: Doanh thu máy (chốt ca) − phí sàn Grab/Shopee − thu chi trong ca (tiền két) − chi phí bill (riêng + phần chia từ chi phí
        chung) − lương (giờ công × lương giờ ± thưởng/phạt + phụ cấp, tính cho cơ sở nơi làm) − tiền thuê nhà chia theo ngày. Bill trả bằng tiền két không cộng lại.
      </p>
    </div>
  );
}
