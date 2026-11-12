"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ActionForm } from "@/components/ActionForm";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/format";
import { syncDayRevenue } from "@/app/admin/actions/closing";
import { setRevenuePickup } from "@/app/admin/actions/revenue";

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

/** cột ẩn / hiện được (Ngày, Cơ sở luôn hiện) */
const COLS = [
  { k: "tk", label: "TK" },
  { k: "tm", label: "TM" },
  { k: "sg", label: "Shopee/Grab" },
  { k: "ket", label: "Két" },
  { k: "thu", label: "DT thật" },
  { k: "dtm", label: "DT máy" },
  { k: "diff", label: "Âm/Dương" },
  { k: "done", label: "Ca đã chốt" },
] as const;
type ColKey = (typeof COLS)[number]["k"];
/** điện thoại (mặc định): chỉ Ngày, Cơ sở, Âm/Dương, Ca đã chốt */
const MOBILE_SHOW = new Set<ColKey>(["diff", "done"]);
const STORE_KEY = "tbs-revenue-hidden-cols";

/**
 * canEdit = Admin Tổng (ghi lại Google Sheet); admin được cấp quyền chỉ xem.
 * hideable: có thanh ẩn / hiện cột – mặc định máy tính hiện đủ, điện thoại chỉ hiện Ngày, Cơ sở, Âm/Dương, Ca đã chốt.
 */
export default function DailyRevenueTable({
  rows,
  today,
  canEdit = false,
  hideable = false,
  pickups,
}: {
  rows: DayRow[];
  today: string;
  canEdit?: boolean;
  hideable?: boolean;
  /** chỉ menu Doanh thu: ô tick "đã lấy doanh thu" (chưa đếm) đầu dòng → dòng tô vàng. key = `${date}|${storeId}` */
  pickups?: Record<string, { by: string; at: string }>;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState(pickups ?? {});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [pickErr, setPickErr] = useState("");
  // tick nhanh nhiều ô: mỗi ô lưu riêng (server xử lý lần lượt). Ô đang lưu dở giữ trạng thái vừa tick,
  // không bị dữ liệu trang tải lại (sau ô lưu trước) ghi đè → không nháy / tự bỏ tick.
  const inflight = useRef(new Map<string, boolean>());
  useEffect(() => {
    setPicked((cur) => {
      const n = { ...(pickups ?? {}) };
      for (const [k, on] of inflight.current) {
        if (on) n[k] = cur[k] ?? n[k] ?? { by: "…", at: new Date().toISOString() };
        else delete n[k];
      }
      return n;
    });
  }, [pickups]);
  const pickable = !!pickups;
  const setOne = (key: string, v: { by: string; at: string } | null) =>
    setPicked((p) => {
      const n = { ...p };
      if (v) n[key] = v;
      else delete n[key];
      return n;
    });
  const togglePick = async (r: DayRow, on: boolean) => {
    const before = picked[r.key] ?? null;
    inflight.current.set(r.key, on);
    setBusy((s) => new Set(s).add(r.key));
    setPickErr("");
    // cập nhật ngay trên màn hình, lỗi thì trả lại riêng ô này
    setOne(r.key, on ? { by: "…", at: new Date().toISOString() } : null);
    const res = await setRevenuePickup(r.storeId, r.date, on).catch((e: Error) => ({ error: e.message || "Không lưu được", by: undefined, at: undefined }));
    // ô này bị bấm lại trong lúc chờ → kết quả lần bấm sau mới là cuối cùng
    if (inflight.current.get(r.key) === on) {
      inflight.current.delete(r.key);
      if (res.error) {
        setOne(r.key, before);
        setPickErr(`${r.dateLabel} ${r.storeName}: ${res.error}`);
      } else if (on) setOne(r.key, { by: res.by ?? "", at: res.at ?? new Date().toISOString() });
      setBusy((s) => {
        const n = new Set(s);
        n.delete(r.key);
        return n;
      });
    }
  };
  const pickTip = (r: DayRow) => {
    const p = picked[r.key];
    if (!p) return "Đánh dấu đã lấy doanh thu (chưa đếm)";
    const d = new Date(p.at);
    return `Đã lấy doanh thu (chưa đếm) – ${p.by} lúc ${d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}. Bỏ tick để huỷ.`;
  };
  const toggle = (k: string) => setOpen((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  // null = mặc định theo màn hình (CSS md:) · Set = người dùng tự chọn (nhớ trên máy này)
  const [hidden, setHidden] = useState<Set<ColKey> | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    if (!hideable) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setHidden(new Set(JSON.parse(saved) as ColKey[]));
    } catch {}
    return () => mq.removeEventListener("change", on);
  }, [hideable]);
  const saveHidden = (h: Set<ColKey> | null) => {
    setHidden(h);
    try {
      if (h) localStorage.setItem(STORE_KEY, JSON.stringify([...h]));
      else localStorage.removeItem(STORE_KEY);
    } catch {}
  };
  const shown = (k: ColKey) => (hidden ? !hidden.has(k) : wide || MOBILE_SHOW.has(k));
  /** class ẩn cột: mặc định dùng CSS (không nháy khi tải trang), đã chọn thì theo lựa chọn */
  const col = (k: ColKey) => (!hideable ? "" : hidden ? (hidden.has(k) ? "hidden" : "") : MOBILE_SHOW.has(k) ? "" : "hidden md:table-cell");
  const flip = (k: ColKey) => saveHidden(new Set(COLS.map((c) => c.k).filter((x) => (x === k ? shown(x) : !shown(x)))));
  const visible = COLS.filter((c) => shown(c.k)).length;
  const tot = rows.reduce(
    (a, r) => ({ tk: a.tk + r.tk, tm: a.tm + r.tm, sg: a.sg + r.sg, ket: a.ket + r.ket, thu: a.thu + r.thu, dtm: a.dtm + (r.dtm ?? 0), diff: a.diff + (r.diff ?? 0) }),
    { tk: 0, tm: 0, sg: 0, ket: 0, thu: 0, dtm: 0, diff: 0 },
  );
  if (!rows.length) return <p className="py-6 text-center text-sm text-ink/50">Chưa có chốt ca trong tháng này.</p>;
  // bảng rộng chỉ khi hiện nhiều cột (điện thoại ẩn bớt → không phải kéo ngang)
  const minW = !hideable ? "min-w-[860px]" : hidden ? (visible >= 6 ? "min-w-[860px]" : "") : "md:min-w-[860px]";
  return (
    <div className="space-y-2">
      {hideable && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-ink/60">Cột:</span>
          {COLS.map((c) => (
            <button
              key={c.k}
              type="button"
              onClick={() => flip(c.k)}
              aria-pressed={shown(c.k)}
              className={cn(
                "rounded-full px-2.5 py-1 ring-1",
                shown(c.k) ? "bg-secondary font-semibold text-white ring-secondary" : "bg-white text-ink/50 ring-[#f1e6c8] line-through",
              )}
            >
              {c.label}
            </button>
          ))}
          <button type="button" onClick={() => saveHidden(new Set())} className="rounded-full px-2 py-1 text-accent underline">
            Hiện tất cả
          </button>
          {hidden && (
            <button type="button" onClick={() => saveHidden(null)} className="rounded-full px-2 py-1 text-ink/60 underline">
              Mặc định
            </button>
          )}
        </div>
      )}
      {pickable && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-ink/60">
          <span className="inline-block h-3 w-5 rounded bg-primary/45 ring-1 ring-primary" /> Tick ô đầu dòng = đã lấy doanh thu của cơ sở ngày đó (chưa đếm).
          {Object.keys(picked).length > 0 && <b className="text-ink">{rows.filter((r) => picked[r.key]).length}/{rows.length} dòng đã lấy</b>}
        </p>
      )}
      {pickErr && <p className="text-xs text-danger">{pickErr}</p>}
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", minW)}>
        <thead>
          <tr className="border-b border-[#f1e6c8] text-xs text-ink/60">
            {pickable && <th className="w-8 py-2" aria-label="Đã lấy doanh thu" title="Đã lấy doanh thu (chưa đếm)">Lấy</th>}
            <th className="py-2 text-left">Ngày</th>
            <th className="text-left">Cơ sở</th>
            <th className={cn("text-right", col("tk"))}>TK</th>
            <th className={cn("text-right", col("tm"))}>TM</th>
            <th className={cn("text-right", col("sg"))}>Shopee/Grab</th>
            <th className={cn("text-right", col("ket"))}>Két</th>
            <th className={cn("text-right", col("thu"))}>DT thật</th>
            <th className={cn("text-right", col("dtm"))}>DT máy</th>
            <th className={cn("text-right", col("diff"))}>Âm/Dương</th>
            <th className={cn("text-center", col("done"))}>Ca đã chốt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.key);
            return (
              <Fragment key={r.key}>
                <tr
                  onClick={() => toggle(r.key)}
                  className={cn(
                    "cursor-pointer border-b border-[#f8f1dd]",
                    pickable && picked[r.key] ? "bg-primary/45 hover:bg-primary/55" : cn("hover:bg-primary-light/50", isOpen && "bg-primary-light/40"),
                  )}
                >
                  {pickable && (
                    <td className="py-2 text-center" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!picked[r.key]}
                        disabled={busy.has(r.key)}
                        onChange={(e) => togglePick(r, e.target.checked)}
                        title={pickTip(r)}
                        aria-label={`Đã lấy doanh thu ${r.dateLabel} ${r.storeName}`}
                        className="h-4 w-4 cursor-pointer accent-[#e4b414]"
                      />
                    </td>
                  )}
                  <td className="py-2 font-semibold whitespace-nowrap">
                    {isOpen ? <ChevronDown size={14} className="mr-1 inline" /> : <ChevronRight size={14} className="mr-1 inline" />}
                    {r.dateLabel}
                  </td>
                  <td className="pr-2">{r.storeName}</td>
                  <td className={cn("text-right tabular-nums", col("tk"))}>{vnd(r.tk)}</td>
                  <td className={cn("text-right tabular-nums", col("tm"))}>{vnd(r.tm)}</td>
                  <td className={cn("text-right tabular-nums", col("sg"))}>{vnd(r.sg)}</td>
                  <td className={cn("text-right tabular-nums text-ink/60", col("ket"))}>{vnd(r.ket)}</td>
                  <td className={cn("text-right font-bold tabular-nums", col("thu"))}>{vnd(r.thu)}</td>
                  <td className={cn("text-right tabular-nums", col("dtm"))}>{r.dtm != null ? vnd(r.dtm) : <span className="text-warn">chưa có</span>}</td>
                  <td className={cn("text-right font-semibold tabular-nums", r.diff ? "text-danger" : "text-secondary-dark", col("diff"))}>{signed(r.diff)}</td>
                  <td className={cn("text-center whitespace-nowrap", col("done"))}>
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
                    <td colSpan={pickable ? 11 : 10} className="bg-cream/60 px-3 py-2">
                      <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-xs">
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
                      </div>
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] text-ink/55">&quot;DT riêng ca&quot; = luỹ kế ca này − luỹ kế ca trước. Doanh thu ngày lấy dòng ca chốt cuối (Tối).</p>
                        <div className="flex items-center gap-2 text-xs" onClick={(e) => e.stopPropagation()}>
                          <span>Google Sheet:</span>
                          {r.sheet ? <Badge tone={SHEET[r.sheet.status as keyof typeof SHEET]?.[1] ?? "gray"}>{SHEET[r.sheet.status as keyof typeof SHEET]?.[0] ?? r.sheet.status}</Badge> : <Badge tone="gray">–</Badge>}
                          {r.sheet?.error && r.sheet.status !== "SENT" && <span className="max-w-60 text-danger">{r.sheet.error}</span>}
                          {canEdit && (
                          <ActionForm action={syncDayRevenue} submitLabel={r.sheet?.status === "SENT" ? "Ghi lại" : "Ghi sheet"} variant="outline" successText="Đã ghi" className="flex">
                            <input type="hidden" name="storeId" value={r.storeId} />
                            <input type="hidden" name="date" value={r.date} />
                          </ActionForm>
                          )}
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
            <td className="py-2" colSpan={pickable ? 3 : 2}>TỔNG ({rows.length} dòng)</td>
            <td className={cn("text-right tabular-nums", col("tk"))}>{vnd(tot.tk)}</td>
            <td className={cn("text-right tabular-nums", col("tm"))}>{vnd(tot.tm)}</td>
            <td className={cn("text-right tabular-nums", col("sg"))}>{vnd(tot.sg)}</td>
            <td className={cn("text-right tabular-nums", col("ket"))}>{vnd(tot.ket)}</td>
            <td className={cn("text-right tabular-nums", col("thu"))}>{vnd(tot.thu)}</td>
            <td className={cn("text-right tabular-nums", col("dtm"))}>{vnd(tot.dtm)}</td>
            <td className={cn("text-right tabular-nums", tot.diff ? "text-danger" : "text-secondary-dark", col("diff"))}>{signed(tot.diff)}</td>
            <td className={col("done")} />
          </tr>
        </tfoot>
      </table>
    </div>
    </div>
  );
}
