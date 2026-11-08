import { Fragment } from "react";
import Link from "next/link";
import type { StoreLite } from "@/lib/finance-data";
import { CATEGORY_LABEL, contributionMargin, COST_LABEL, margin, STORE_COST_KEYS, type PnlLine, type PnlResult } from "@/lib/finance";
import { viDate, viMonth, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, Empty } from "@/components/ui";
import { cn } from "@/lib/format";
import CostPie, { type Slice } from "./CostPie";

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

/** Lãi lỗ TOÀN CHUỖI (mặc định) + lãi gộp từng cơ sở (tuỳ chọn phân bổ chi phí chung). */
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
  alloc = false,
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
  alloc?: boolean;
}) {
  const t = pnl.total;
  const pt = prev.total;
  const storeKeys = STORE_COST_KEYS.filter((k) => k !== "direct" || t.direct > 0);
  const commonCats = Object.entries(pnl.byCategory).sort((a, b) => b[1] - a[1]);
  const shownDates = [...dates].reverse();
  const link = (a: boolean) => `/admin/finance?month=${month}${a ? "&alloc=1" : ""}`;

  // biểu đồ tròn: màu cố định theo loại chi phí (không đổi theo thứ hạng); loại nhỏ gộp vào "Khác"
  const PALETTE = { labor: "#2a78d6", fixed: "#eb6834", NGUYEN_LIEU: "#1baf7a", cashbox: "#eda100", platformFee: "#e87ba4", BAO_BI: "#6250d6" } as const;
  const otherCommon = commonCats.filter(([k]) => k !== "NGUYEN_LIEU" && k !== "BAO_BI").reduce((x, [, v]) => x + v, 0);
  const slices: Slice[] = [
    { key: "labor", label: "Lương NV", value: t.labor, color: PALETTE.labor },
    { key: "fixed", label: "Tiền thuê nhà", value: t.fixed, color: PALETTE.fixed },
    { key: "NGUYEN_LIEU", label: "Nguyên liệu", value: pnl.byCategory.NGUYEN_LIEU ?? 0, color: PALETTE.NGUYEN_LIEU },
    { key: "cashbox", label: "Chi phí trong ca (két)", value: t.cashbox, color: PALETTE.cashbox },
    { key: "platformFee", label: "Phí sàn Grab/Shopee", value: t.platformFee, color: PALETTE.platformFee },
    { key: "BAO_BI", label: "Bao bì, ly, ống hút", value: pnl.byCategory.BAO_BI ?? 0, color: PALETTE.BAO_BI },
    {
      key: "other",
      label: `Khác${otherCommon ? ` (${commonCats.filter(([k]) => k !== "NGUYEN_LIEU" && k !== "BAO_BI").map(([k]) => CATEGORY_LABEL[k] ?? k).join(", ")})` : ""}`,
      value: otherCommon + t.direct,
      color: "#9a9a92",
    },
  ].sort((x, y) => (x.key === "other" ? 1 : y.key === "other" ? -1 : y.value - x.value));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MonthPicker month={month} base="/admin/finance" params={{ alloc: alloc ? "1" : undefined }} />
        <span className="text-xs text-ink/60">
          {viDate(first)} – {viDate(to)} · so với {viDate(prevFirst)} – {viDate(prevTo)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="p-3">
          <p className="text-xs text-ink/60">Doanh thu thực thu (cả chuỗi)</p>
          <p className="text-xl font-bold tabular-nums">{vnd(t.revenue)}</p>
          <Delta now={t.revenue} prev={pt.revenue} />
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink/60">Tổng chi phí</p>
          <p className="text-xl font-bold tabular-nums">{vnd(t.cost)}</p>
          <Delta now={t.cost} prev={pt.cost} invert />
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink/60">Lãi toàn chuỗi (ước tính)</p>
          <p className={cn("text-xl font-bold tabular-nums", profitCls(t.profit))}>{signed(t.profit)}</p>
          <Delta now={t.profit} prev={pt.profit} />
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink/60">Biên lãi chuỗi</p>
          <p className={cn("text-xl font-bold tabular-nums", profitCls(t.profit))}>{pct(margin(t))}</p>
          <span className="text-xs text-ink/50">kỳ trước {pct(margin(pt))}</span>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
        <Card title="Lãi lỗ toàn chuỗi">
          <table className="w-full text-sm">
            <tbody>
              {stores.map((st) => {
                const l = pnl.byStore[st._id];
                const plus: [string, number][] = [
                  ["Tiền mặt", l.tm],
                  ["Tài khoản", l.tk],
                  ["Grab", l.grab],
                  ["Shopee", l.shopee],
                  ["Tiền két đã chi trong ca", l.cashbox],
                ];
                const minus = storeKeys.map((k) => [COST_LABEL[k], l[k]] as [string, number]);
                return (
                  <Fragment key={st._id}>
                    <tr className="border-t-2 border-[#f1e6c8]">
                      <td className="pt-2.5 pb-1 font-bold text-accent" colSpan={2}>
                        Doanh thu thực thu {st.name}
                        <span className="ml-2 text-xs font-normal text-ink/50">DT máy đối chiếu {vnd(l.machine)}</span>
                      </td>
                    </tr>
                    {plus
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <tr key={k} className="text-ink/80">
                          <td className="py-0.5 pl-4">+ {k}</td>
                          <td className="py-0.5 text-right tabular-nums">{vnd(v)}</td>
                        </tr>
                      ))}
                    {minus
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <tr key={k} className="text-ink/60">
                          <td className="py-0.5 pl-4">− {k}</td>
                          <td className="py-0.5 text-right tabular-nums">{vnd(v)}</td>
                        </tr>
                      ))}
                    <tr className="border-b border-[#f8f1dd] font-semibold">
                      <td className="py-1.5 pl-4">= Lãi gộp {st.short}</td>
                      <td className={cn("py-1.5 text-right tabular-nums", profitCls(l.contribution))}>{signed(l.contribution)}</td>
                    </tr>
                  </Fragment>
                );
              })}
              <tr className="border-y-2 border-[#f1e6c8] bg-cream font-bold">
                <td className="py-1.5 pl-1">Σ Lãi gộp các cơ sở</td>
                <td className={cn("py-1.5 text-right tabular-nums", profitCls(t.contribution))}>{signed(t.contribution)}</td>
              </tr>
              <tr className="border-b border-[#f8f1dd]">
                <td className="py-1.5 pl-3 text-ink/70">− {COST_LABEL.shared}</td>
                <td className="py-1.5 text-right tabular-nums text-ink/70">{vnd(t.shared)}</td>
              </tr>
              {commonCats.map(([k, v]) => (
                <tr key={k} className="text-xs text-ink/55">
                  <td className="py-0.5 pl-7">{CATEGORY_LABEL[k] ?? k}</td>
                  <td className="py-0.5 text-right tabular-nums">{vnd(v)}</td>
                </tr>
              ))}
              <tr className="bg-[#e3f3e7] text-base font-bold">
                <td className="py-2 pl-1">= LÃI TOÀN CHUỖI</td>
                <td className={cn("py-2 text-right tabular-nums", profitCls(t.profit))}>{signed(t.profit)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Cơ cấu chi phí">
          <CostPie slices={slices} total={t.cost} revenue={t.revenue} />
        </Card>
      </div>

      <Card
        title="Theo cơ sở"
        actions={
          <div className="flex rounded-lg bg-gray-100 p-0.5 text-xs">
            <Link href={link(false)} className={cn("rounded-md px-2.5 py-1", !alloc && "bg-white font-bold shadow-sm")}>Lãi gộp cơ sở</Link>
            <Link href={link(true)} className={cn("rounded-md px-2.5 py-1", alloc && "bg-white font-bold shadow-sm")}>Phân bổ chi phí chung</Link>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
                <th className="py-2 text-left font-semibold">Khoản</th>
                {stores.map((s) => <th key={s._id} className="py-2 text-right font-semibold">{s.short}</th>)}
                <th className="py-2 text-right font-semibold">Cả chuỗi</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const cols: PnlLine[] = [...stores.map((s) => pnl.byStore[s._id]), t];
                const allocCols = [...stores.map((s) => pnl.allocByStore[s._id] ?? 0), t.shared];
                const row = (label: string, vals: number[], cls?: string, color = false) => (
                  <tr key={label} className={cn("border-b border-[#f8f1dd]", cls)}>
                    <td className="py-1.5 pr-2">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={cn("py-1.5 text-right tabular-nums", color && profitCls(v))}>{signed(v)}</td>
                    ))}
                  </tr>
                );
                return (
                  <>
                    {row("Doanh thu thực thu", cols.map((l) => l.revenue), "font-bold")}
                    {row("DT máy (đối chiếu)", cols.map((l) => l.machine), "text-xs text-ink/50")}
                    {storeKeys.map((k) => row(`− ${COST_LABEL[k]}`, cols.map((l) => l[k]), "text-ink/70"))}
                    {row("= Lãi gộp cơ sở", cols.map((l) => l.contribution), "bg-cream font-bold", true)}
                    <tr className="text-xs text-ink/60">
                      <td className="py-1">Biên lãi gộp</td>
                      {cols.map((l, i) => <td key={i} className="py-1 text-right">{pct(contributionMargin(l))}</td>)}
                    </tr>
                    {alloc && (
                      <>
                        {row("− Chi phí chung (chia theo tỷ lệ doanh thu)", allocCols, "text-ink/70")}
                        {row(
                          "= Lãi sau phân bổ (tham khảo)",
                          cols.map((l, i) => l.contribution - allocCols[i]),
                          "bg-[#e3f3e7] font-bold",
                          true,
                        )}
                      </>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink/55">
          {alloc
            ? "Chi phí chung chia cho cơ sở theo tỷ lệ doanh thu thực thu trong kỳ – chỉ để tham khảo, lãi thật của chuỗi là số ở bảng trên."
            : "Lãi gộp = phần mỗi cơ sở đóng góp để trả chi phí chung của chuỗi (chưa trừ chi phí admin nhập). Bấm \"Phân bổ chi phí chung\" để xem lãi sau khi chia."}
        </p>
      </Card>

      <Card title="Theo ngày (cả chuỗi)">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
                <th className="py-2 text-left font-semibold">Ngày</th>
                <th className="py-2 text-right font-semibold">Doanh thu</th>
                <th className="py-2 text-right font-semibold">Lãi gộp CS</th>
                <th className="py-2 text-right font-semibold">Chi phí chung</th>
                <th className="py-2 text-right font-semibold">Lãi chuỗi</th>
              </tr>
            </thead>
            <tbody>
              {shownDates.map((d) => {
                const l = pnl.byDate[d];
                return (
                  <tr key={d} className="border-b border-[#f8f1dd]">
                    <td className="py-1.5 whitespace-nowrap">
                      {viDate(d).slice(0, 5)} <span className="text-xs text-ink/50">{weekdayVi(d).replace("Thứ ", "T").replace("Chủ Nhật", "CN")}</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{l.revenue ? vnd(l.revenue) : "–"}</td>
                    <td className={cn("py-1.5 text-right tabular-nums", profitCls(l.contribution))}>{l.revenue || l.cost ? signed(l.contribution) : "–"}</td>
                    <td className="py-1.5 text-right tabular-nums text-ink/70">{l.shared ? vnd(l.shared) : "–"}</td>
                    <td className={cn("py-1.5 text-right font-semibold tabular-nums", profitCls(l.profit))}>{l.revenue || l.cost ? signed(l.profit) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink/55">Chi phí chung tính vào ngày chi (ngày trên sao kê) nên lãi từng ngày dao động – xem tổng tháng để đánh giá.</p>
      </Card>

      <p className="text-xs text-ink/60">
        T{viMonth(month)} · Doanh thu thực thu = TM + TK + Grab + Shopee + tiền két đã chi (lấy từ chốt ca). Chi phí cơ sở: phí sàn, chi phí trong ca, lương (giờ công × lương
        giờ ± thưởng/phạt + phụ cấp, tính cho cơ sở nơi làm), tiền thuê nhà chia theo ngày. Chi phí chung: các khoản admin nhập từ sao kê / CK có tick &quot;Tính vào chi
        phí&quot;.
      </p>
    </div>
  );
}
