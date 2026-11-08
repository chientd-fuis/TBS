"use client";
import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/format";
import { syncDayRevenue } from "@/app/admin/actions/closing";

type Fig = { tk: number; tm: number; sg: number; ket: number; thu: number; dtm: number | null; diff: number | null };
export type DayRow = Fig & {
  key: string;
  date: string;
  dateLabel: string;
  storeId: string;
  storeName: string;
  done: string[];
  final: boolean;
  sheet: { status: string; error: string; range: string } | null;
  shifts: (Fig & { name: string; at: string; who: string; own: number; staffTotal: number | null; totalOk: boolean | null })[];
};

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const signed = (n: number | null) => (n == null ? "—" : n ? `${n > 0 ? "+" : ""}${vnd(n)}` : "0");
const SHEET = { SENT: ["Đã ghi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Chờ ghi", "yellow"], DISABLED: ["Chưa cấu hình", "gray"] } as const;

export default function DailyRevenueTable({ rows, today }: { rows: DayRow[]; today: string }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const tot = rows.reduce(
    (a, r) => ({ tk: a.tk + r.tk, tm: a.tm + r.tm, sg: a.sg + r.sg, ket: a.ket + r.ket, thu: a.thu + r.thu, dtm: a.dtm + (r.dtm ?? 0), diff: a.diff + (r.diff ?? 0) }),
    { tk: 0, tm: 0, sg: 0, ket: 0, thu: 0, dtm: 0, diff: 0 },
  );
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink/50">Chưa có chốt ca trong tháng này.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
            <th className="py-2 text-left">Ngày</th>
            <th className="text-left">Cơ sở</th>
            <th className="text-right">TK</th>
            <th className="text-right">TM</th>
            <th className="text-right">Shopee/Grab</th>
            <th className="text-right">Két</th>
            <th className="text-right">DT thật</th>
            <th className="text-right">DT máy</th>
            <th className="text-right">Âm/Dương</th>
            <th className="text-center">Ca đã chốt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            return (
              <Fragment key={r.key}>
                <tr onClick={() => toggle(r.key)} className={cn("cursor-pointer border-b border-[#f8f1dd] hover:bg-primary-light/50", isOpen && "bg-primary-light/40")}>
                  <td className="py-2 font-semibold whitespace-nowrap">
                    {isOpen ? <ChevronDown size={14} className="mr-1 inline" /> : <ChevronRight size={14} className="mr-1 inline" />}
                    {r.dateLabel}
                  </td>
                  <td>{r.storeName}</td>
                  <td className="text-right tabular-nums">{vnd(r.tk)}</td>
                  <td className="text-right tabular-nums">{vnd(r.tm)}</td>
                  <td className="text-right tabular-nums">{vnd(r.sg)}</td>
                  <td className="text-right tabular-nums text-ink/60">{vnd(r.ket)}</td>
                  <td className="text-right font-bold tabular-nums">{vnd(r.thu)}</td>
                  <td className="text-right tabular-nums">{r.dtm != null ? vnd(r.dtm) : <span className="text-warn">chưa có</span>}</td>
                  <td className={cn("text-right font-semibold tabular-nums", r.diff ? "text-danger" : "text-secondary-dark")}>{signed(r.diff)}</td>
                  <td className="text-center whitespace-nowrap">
                    {(["Sáng", "Chiều", "Tối"] as const).map((n) => (
                      <span key={n} className={cn("mx-0.5 inline-block rounded px-1.5 text-[10px] font-bold", r.done.includes(n) ? "bg-secondary text-white" : "bg-gray-100 text-gray-400")}>
                        {n[0]}
                      </span>
                    ))}
                    {!r.final && <div className="text-[10px] text-warn">{r.date === today ? "đang trong ngày" : "chưa chốt Tối – tạm tính"}</div>}
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={10} className="bg-cream/60 px-3 py-2">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-ink/55">
                            <th className="py-1 text-left">Ca</th>
                            <th className="text-left">Chốt lúc · Thu ngân</th>
                            <th className="text-right">TK</th>
                            <th className="text-right">TM</th>
                            <th className="text-right">Shopee/Grab</th>
                            <th className="text-right">Két</th>
                            <th className="text-right">DT thật luỹ kế</th>
                            <th className="text-right">DT riêng ca</th>
                            <th className="text-right">DT máy</th>
                            <th className="text-right">Âm/Dương</th>
                            <th className="text-right">Tổng NV ghi</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(["Sáng", "Chiều", "Tối"] as const).map((n) => {
                            const s = r.shifts.find((x) => x.name === n);
                            if (!s)
                              return (
                                <tr key={n} className="border-t border-[#f1e6c8]">
                                  <td className="py-1.5 font-semibold">Ca {n}</td>
                                  <td colSpan={10} className="text-ink/40">chưa chốt</td>
                                </tr>
                              );
                            return (
                              <tr key={n} className="border-t border-[#f1e6c8]">
                                <td className="py-1.5 font-semibold">Ca {n}</td>
                                <td>{s.at} · {s.who}</td>
                                <td className="text-right tabular-nums">{vnd(s.tk)}</td>
                                <td className="text-right tabular-nums">{vnd(s.tm)}</td>
                                <td className="text-right tabular-nums">{vnd(s.sg)}</td>
                                <td className="text-right tabular-nums">{vnd(s.ket)}</td>
                                <td className="text-right font-semibold tabular-nums">{vnd(s.thu)}</td>
                                <td className="text-right tabular-nums text-accent">{vnd(s.own)}</td>
                                <td className="text-right tabular-nums">{s.dtm != null ? vnd(s.dtm) : "—"}</td>
                                <td className={cn("text-right tabular-nums", s.diff ? "text-danger" : "text-secondary-dark")}>{signed(s.diff)}</td>
                                <td className={cn("text-right tabular-nums", s.totalOk === false ? "text-danger" : "text-secondary-dark")}>
                                  {s.staffTotal != null ? `${vnd(s.staffTotal)} ${s.totalOk ? "✓" : "✗"}` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                          {r.shifts
                            .filter((s) => !["Sáng", "Chiều", "Tối"].includes(s.name))
                            .map((s, i) => (
                              <tr key={`x${i}`} className="border-t border-[#f1e6c8] text-ink/60">
                                <td className="py-1.5">{s.name}</td>
                                <td>{s.at} · {s.who}</td>
                                <td colSpan={9}>Doanh thu {vnd(s.thu)} (lượt chốt ngoài ca)</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-ink/55">&quot;DT riêng ca&quot; = luỹ kế ca này − luỹ kế ca trước. Doanh thu ngày lấy dòng ca chốt cuối (Tối).</p>
                        <div className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                          <span>Google Sheet:</span>
                          {r.sheet ? <Badge tone={SHEET[r.sheet.status as keyof typeof SHEET]?.[1] ?? "gray"}>{SHEET[r.sheet.status as keyof typeof SHEET]?.[0] ?? r.sheet.status}</Badge> : <Badge tone="gray">–</Badge>}
                          {r.sheet?.error && r.sheet.status !== "SENT" && <span className="max-w-60 text-danger">{r.sheet.error}</span>}
                          <ActionForm action={syncDayRevenue} submitLabel={r.sheet?.status === "SENT" ? "Ghi lại" : "Ghi sheet"} variant="outline" successText="Đã ghi" className="flex">
                            <input type="hidden" name="storeId" value={r.storeId} />
                            <input type="hidden" name="date" value={r.date} />
                          </ActionForm>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-[#f1e6c8] bg-[#e3f3e7] font-bold">
            <td className="py-2" colSpan={2}>TỔNG ({rows.length} dòng)</td>
            <td className="text-right tabular-nums">{vnd(tot.tk)}</td>
            <td className="text-right tabular-nums">{vnd(tot.tm)}</td>
            <td className="text-right tabular-nums">{vnd(tot.sg)}</td>
            <td className="text-right tabular-nums">{vnd(tot.ket)}</td>
            <td className="text-right tabular-nums">{vnd(tot.thu)}</td>
            <td className="text-right tabular-nums">{vnd(tot.dtm)}</td>
            <td className={cn("text-right tabular-nums", tot.diff ? "text-danger" : "text-secondary-dark")}>{signed(tot.diff)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
