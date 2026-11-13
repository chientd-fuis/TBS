import { Fragment } from "react";
import Link from "next/link";
import type { StoreLite } from "@/lib/finance-data";
import { contributionMargin, COST_GROUP_LABEL, COST_GROUPS, COST_LABEL, margin, STORE_COST_KEYS, type PnlLine, type PnlResult } from "@/lib/finance";
import { viDate, viMonth, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, Empty } from "@/components/ui";
import { cn } from "@/lib/format";
import CostPie, { type Slice } from "./CostPie";

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const signed = (n: number) => `${n < 0 ? "−" : ""}${vnd(Math.abs(n))}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const profitCls = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-danger" : "text-ink/50");

function Delta({ now, prev, invert = false }: { now: number; prev: number; invert?: boolean }) {
  if (!prev) return <span className="text-xs text-ink/40">–</span>;
  const d = (now - prev) / Math.abs(prev);
  const good = invert ? d <= 0 : d >= 0;
  return (
    <span className={cn("text-xs font-semibold", good ? "text-good" : "text-danger")}>
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
  const shownDates = [...dates].reverse();
  const link = (a: boolean) => `/admin/finance?month=${month}${a ? "&alloc=1" : ""}`;

  // biểu đồ tròn: màu cố định theo loại chi phí (không đổi theo thứ hạng)
  const cat = (k: string) => pnl.byCategory[k] ?? 0;
  // 5 loại chi phí theo yêu cầu; tổng = Tổng chi phí (gồm cả chi phí két)
  const slices: Slice[] = [
    { key: "labor", label: "Lương NV", value: t.labor + cat("LUONG"), color: "#2a78d6" },
    { key: "shared", label: "Chi phí (NL, điện nước, khác)", value: t.shared - cat("LUONG") + t.direct, color: "#1baf7a" },
    { key: "fixed", label: "Chi phí cố định – Mặt bằng", value: t.fixed, color: "#eb6834" },
    { key: "platformFee", label: "Phí sàn Shopee/Grab", value: t.platformFee, color: "#e87ba4" },
    { key: "cashbox", label: "Chi phí két", value: t.cashbox, color: "#eda100" },
  ];
  // biểu đồ tỷ lệ chi phí / doanh thu: mỗi nhóm chi phí + phần lãi còn lại (cả vòng = doanh thu; lỗ thì cả vòng = tổng chi phí)
  const GROUP_COLOR = { LUONG: "#2a78d6", MAT_BANG: "#eb6834", NGUYEN_LIEU: "#1baf7a", KET: "#eda100", DIEN_NUOC: "#6250d6", KHAC: "#e87ba4" } as const;
  const ratioSlices: Slice[] = [
    ...COST_GROUPS.map((g) => ({ key: g, label: COST_GROUP_LABEL[g], value: Math.max(0, pnl.costGroups[g]), color: GROUP_COLOR[g] })),
    { key: "profit", label: "Lãi còn lại", value: Math.max(0, t.profit), color: "#d6d3cc" },
  ];
  const ratioTotal = ratioSlices.reduce((s, x) => s + x.value, 0);
  /** Tổng chi phí = Lương + Chi phí + Mặt bằng + Phí sàn + Chi phí két; Lãi = Doanh thu thật − Tổng chi phí */
  const totalCost = t.cost;
  const prevTotalCost = pt.cost;

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
          <p className="text-xs text-ink/60">Doanh thu thật 3 cơ sở</p>
          <p className="text-xl font-bold tabular-nums">{vnd(t.revenue)}</p>
          <Delta now={t.revenue} prev={pt.revenue} />
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink/60">Tổng chi phí</p>
          <p className="text-xl font-bold tabular-nums">{vnd(totalCost)}</p>
          <Delta now={totalCost} prev={prevTotalCost} invert />
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink/60">Lãi (ước tính)</p>
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
              {(() => {
                const group = (title: string, total: number, items: [string, number][], sign: "+" | "−", note?: string) => (
                  <>
                    <tr className="border-t-2 border-line">
                      <td className="pt-2.5 pb-1 font-bold text-accent">
                        {sign === "−" ? "− " : ""}
                        {title}
                      </td>
                      <td className="pt-2.5 pb-1 text-right font-bold tabular-nums">{vnd(total)}</td>
                    </tr>
                    {items.map(([k, v]) => (
                      <tr key={k} className="text-ink/70">
                        <td className="py-0.5 pl-5">{k}</td>
                        <td className="py-0.5 text-right tabular-nums">{vnd(v)}</td>
                      </tr>
                    ))}
                    {note && (
                      <tr className="text-xs text-ink/50">
                        <td className="pt-0.5 pb-1.5 pl-5" colSpan={2}>{note}</td>
                      </tr>
                    )}
                  </>
                );
                const per = (f: (l: PnlLine) => number) => stores.map((st) => [st.name, f(pnl.byStore[st._id])] as [string, number]);
                const costItems: [string, number][] = [
                  ["Nguyên liệu", cat("NGUYEN_LIEU")],
                  ["Điện nước", cat("DIEN_NUOC")],
                  ["Khác", cat("KHAC")],
                  ...(cat("LUONG") ? [["Lương / thưởng (chuyển khoản, có tick tính)", cat("LUONG")] as [string, number]] : []),
                ];
                return (
                  <>
                    <tr className="border-t-2 border-line">
                      <td className="pt-2.5 pb-1 font-bold text-accent">
                        Doanh thu thật (chốt ca)
                        <span className="block text-xs font-normal text-ink/55">= TK + TM + Shopee/Grab + Chi phí két (két là tiền doanh thu lấy ra chi)</span>
                      </td>
                      <td className="pt-2.5 pb-1 text-right font-bold tabular-nums">{vnd(t.revenue)}</td>
                    </tr>
                    {stores.map((st) => {
                      const l = pnl.byStore[st._id];
                      return (
                        <Fragment key={st._id}>
                          <tr className="font-semibold">
                            <td className="pt-1 pl-5">{st.name}</td>
                            <td className="pt-1 text-right tabular-nums">{vnd(l.revenue)}</td>
                          </tr>
                          {(
                            [
                              ["+ Tài khoản", l.tk],
                              ["+ Tiền mặt", l.tm],
                              ["+ Shopee / Grab", l.shopee + l.grab],
                              ["+ Chi phí két", l.cashbox],
                            ] as [string, number][]
                          ).map(([k, v]) => (
                            <tr key={k} className="text-xs text-ink/65">
                              <td className="pl-10">{k}</td>
                              <td className="text-right tabular-nums">{vnd(v)}</td>
                            </tr>
                          ))}
                          <tr className="text-xs text-ink/45">
                            <td className="pb-1 pl-10" colSpan={2}>
                              DT máy {l.machine ? vnd(l.machine) : "—"} · Âm/Dương {l.machine ? `${l.machine - l.revenue > 0 ? "+" : ""}${vnd(l.machine - l.revenue)}` : "—"}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                    {group("Chi phí két (chi trong ca)", t.cashbox, per((l) => l.cashbox), "−", "Sữa chua, ship… lấy từ tiền doanh thu trong két")}
                    {group("Lương NV", t.labor, per((l) => l.labor), "−", "Giờ công × lương giờ ± thưởng/phạt + phụ cấp (ước tính, tính cho cơ sở nơi làm)")}
                    {group("Chi phí (admin nhập)", t.shared, costItems, "−")}
                    {group("Chi phí cố định – Mặt bằng", t.fixed, per((l) => l.fixed), "−")}
                    {group(
                      "Phí sàn Shopee/Grab",
                      t.platformFee,
                      stores.map((st) => [`${st.name} (Grab ${st.grabFeePct}% · Shopee ${st.shopeeFeePct}%)`, pnl.byStore[st._id].platformFee] as [string, number]),
                      "−",
                      t.platformFee ? undefined : "Chưa đặt % phí sàn – vào tab Cài đặt",
                    )}
                    {t.direct > 0 && group("Chi phí gắn riêng cơ sở (dữ liệu cũ)", t.direct, per((l) => l.direct), "−")}
                    <tr className="border-t-2 border-line bg-cream font-bold">
                      <td className="py-2 pl-1">
                        Tổng chi phí
                        <span className="block text-xs font-normal text-ink/55">Chi phí két + Lương NV + Chi phí + Mặt bằng + Phí sàn</span>
                      </td>
                      <td className="py-2 text-right tabular-nums">{vnd(totalCost)}</td>
                    </tr>
                    <tr className="border-t-2 border-line bg-ok-bg text-base font-bold">
                      <td className="py-2 pl-1">
                        = LÃI
                        <span className="block text-xs font-normal text-ink/55">Doanh thu thật − Tổng chi phí</span>
                      </td>
                      <td className={cn("py-2 text-right tabular-nums", profitCls(t.profit))}>{signed(t.profit)}</td>
                    </tr>
                  </>
                );
              })()}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title="Cơ cấu chi phí">
            <CostPie slices={slices} total={totalCost} revenue={t.revenue} />
          </Card>
          <Card title="Tỷ lệ chi phí so với doanh thu">
            <CostPie
              slices={ratioSlices}
              total={ratioTotal}
              revenue={t.revenue}
              pctOf={t.revenue}
              center={{ label: "Doanh thu thật", value: t.revenue, sub: t.revenue > 0 ? `chi phí ${pct(totalCost / t.revenue)}` : undefined }}
              ariaLabel="Biểu đồ tròn tỷ lệ từng nhóm chi phí so với tổng doanh thu"
              empty={t.revenue > 0 ? "Chưa có chi phí." : "Chưa có doanh thu trong kỳ."}
              footer={
                <p className="w-full text-xs text-ink/60">
                  % = khoản đó ÷ doanh thu thật. Chi phí khác gồm cả phí sàn Shopee/Grab.
                  {t.profit < 0 && <span className="font-semibold text-danger"> Đang lỗ: tổng chi phí vượt doanh thu {pct(-t.profit / Math.max(1, t.revenue))}.</span>}
                </p>
              }
            />
          </Card>
        </div>
      </div>

      <Card
        title="Theo cơ sở (tham khảo)"
        actions={
          <div className="flex rounded-lg bg-mute-bg p-0.5 text-xs">
            <Link href={link(false)} className={cn("rounded-md px-2.5 py-1", !alloc && "bg-card font-bold shadow-sm")}>Lãi gộp cơ sở</Link>
            <Link href={link(true)} className={cn("rounded-md px-2.5 py-1", alloc && "bg-card font-bold shadow-sm")}>Phân bổ chi phí chung</Link>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink/60">
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
                  <tr key={label} className={cn("border-b border-line", cls)}>
                    <td className="py-1.5 pr-2">{label}</td>
                    {vals.map((v, i) => (
                      <td key={i} className={cn("py-1.5 text-right tabular-nums", color && profitCls(v))}>{signed(v)}</td>
                    ))}
                  </tr>
                );
                return (
                  <>
                    {row("Doanh thu thật (chốt ca)", cols.map((l) => l.revenue), "font-bold")}
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
                          "bg-ok-bg font-bold",
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
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-line text-xs text-ink/60">
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
                  <tr key={d} className="border-b border-line">
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
        T{viMonth(month)} · Doanh thu thật = TK + TM + Grab + Shopee + Chi phí két (từ chốt ca, lấy ca Tối). Âm/Dương = DT máy − Doanh thu thật.
        Lãi = Doanh thu thật − Chi phí két − Lương NV − Chi phí admin nhập (có tick &quot;Tính vào chi phí&quot;) − Mặt bằng − Phí sàn.
      </p>
    </div>
  );
}
