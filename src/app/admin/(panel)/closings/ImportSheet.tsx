"use client";
import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Sheet } from "lucide-react";
import { applySheetBatch, previewSheetBatch, sheetImportTabs, undoSheetImport, type BatchItem, type BatchPreviewItem, type SheetTab } from "../../actions/sheet-import";

const vnd = (n?: number | null) => (n ? n.toLocaleString("vi-VN") : "—");
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const mLabel = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const ST = { new: ["Sẽ nhập", "text-good"], exists: ["Đã có chốt ca trên app – bỏ qua", "text-ink/50"], imported: ["Đã import – bỏ qua", "text-ink/50"] } as const;
const keyOf = (storeId: string, tab: string) => `${storeId}|${tab}`;

type StoreTabs = { tabs?: SheetTab[]; cur?: string; error?: string };

/**
 * Chốt ca → Import từ Google Sheet (HÀNG LOẠT): chọn nhiều cơ sở × nhiều tab tháng cũ (T10-26, T10…) → chốt ca Tối từng ngày.
 * Mặc định đánh dấu đã lấy + đã đếm tiền, không đưa TM / TK vào Sổ quỹ (tiền đã lấy rồi). Chỉ Admin Tổng.
 */
export default function ImportSheet({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [msg, setMsg] = useState<string[]>([]);
  // bước 1: cơ sở
  const [selStores, setSelStores] = useState<string[]>(() => stores.map((s) => s.id));
  const [tabsBy, setTabsBy] = useState<Record<string, StoreTabs>>({});
  // bước 2: tab đã chọn → tháng (tab không đoán được tháng thì admin nhập)
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [scales, setScales] = useState<Record<string, number>>({});
  // bước 3: xem trước
  const [pv, setPv] = useState<BatchPreviewItem[] | null>(null);
  const [expand, setExpand] = useState<string | null>(null);
  const [markTaken, setMarkTaken] = useState(true);

  const run = (f: () => Promise<void>) => {
    setError("");
    start(async () => {
      try {
        await f();
      } catch {
        setError("Mất kết nối – thử lại");
      }
    });
  };
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "?";

  const loadTabs = () =>
    run(async () => {
      setMsg([]);
      setPv(null);
      const res = await Promise.all(selStores.map(async (id) => [id, await sheetImportTabs(id)] as const));
      const next: Record<string, StoreTabs> = {};
      for (const [id, r] of res) next[id] = r.error ? { error: r.error } : { tabs: r.tabs ?? [], cur: r.curMonth };
      setTabsBy(next);
      // bỏ các tab đã chọn của cơ sở không còn trong danh sách
      setPicks((p) => Object.fromEntries(Object.entries(p).filter(([k]) => next[k.split("|")[0]]?.tabs?.some((t) => t.tab === k.slice(k.indexOf("|") + 1)))));
    });

  const togglePick = (storeId: string, t: SheetTab) => {
    const k = keyOf(storeId, t.tab);
    setPv(null);
    setPicks((p) => {
      const n = { ...p };
      if (k in n) delete n[k];
      else n[k] = t.month && t.past ? t.month : "";
      return n;
    });
  };
  const pickAllPast = (storeId: string, on: boolean) => {
    setPv(null);
    setPicks((p) => {
      const n = { ...p };
      for (const t of tabsBy[storeId]?.tabs ?? []) {
        if (!t.month || !t.past) continue;
        const k = keyOf(storeId, t.tab);
        if (on) n[k] = t.month;
        else delete n[k];
      }
      return n;
    });
  };

  const items = (): BatchItem[] =>
    Object.entries(picks)
      .filter(([, m]) => !!m)
      .map(([k, month]) => {
        const i = k.indexOf("|");
        return { storeId: k.slice(0, i), tab: k.slice(i + 1), month, scale: scales[k] ?? 1 };
      });
  const missingMonth = Object.values(picks).filter((m) => !m).length;

  const preview = () =>
    run(async () => {
      setMsg([]);
      const r = await previewSheetBatch(items());
      if (r.error) return setError(r.error);
      setPv(r.items ?? []);
    });

  /** đổi đơn vị (nhân 1.000) cho 1 tab → xem lại riêng tab đó */
  const rescale = (it: BatchPreviewItem, sc: number) => {
    const k = keyOf(it.storeId, it.tab);
    setScales((s) => ({ ...s, [k]: sc }));
    run(async () => {
      const r = await previewSheetBatch([{ storeId: it.storeId, tab: it.tab, month: it.month, scale: sc }]);
      if (r.error) return setError(r.error);
      setPv((list) => list?.map((x) => (keyOf(x.storeId, x.tab) === k ? r.items![0] : x)) ?? null);
    });
  };

  const todoOf = (it: BatchPreviewItem) => (it.rows ?? []).filter((r) => r.status === "new");
  const ready = (pv ?? []).filter((it) => !it.error && todoOf(it).length);
  const totalDays = ready.reduce((s, it) => s + todoOf(it).length, 0);
  const totalDt = ready.reduce((s, it) => s + todoOf(it).reduce((a, r) => a + r.revenue.dt, 0), 0);
  // cùng cơ sở, 2 tab cùng 1 tháng → tab sau sẽ bị bỏ qua
  const dupMonth = (it: BatchPreviewItem) => (pv ?? []).filter((x) => x.storeId === it.storeId && x.month === it.month).length > 1;

  const apply = () =>
    run(async () => {
      const r = await applySheetBatch(
        ready.map(({ storeId, tab, month, scale }) => ({ storeId, tab, month, scale })),
        markTaken,
      );
      if (r.error) return setError(r.error);
      const lines = (r.items ?? []).map((x) =>
        x.error ? `✕ ${x.storeName} · ${x.tab}: ${x.error}` : `✓ ${x.storeName} · tháng ${mLabel(x.month)}: nhập ${x.created} ngày${x.skipped ? `, bỏ qua ${x.skipped}` : ""}`,
      );
      setMsg(lines);
      setPv(null);
      setPicks({});
      router.refresh();
    });

  const undo = (it: BatchPreviewItem) => {
    if (!window.confirm(`Xoá toàn bộ dữ liệu đã import từ sheet tháng ${mLabel(it.month)} – ${it.storeName}? Chốt ca thật trên app không bị ảnh hưởng.`)) return;
    run(async () => {
      const r = await undoSheetImport({ storeId: it.storeId, month: it.month });
      if (r.error) return setError(r.error);
      setMsg([`Đã xoá ${r.skipped} ngày đã import tháng ${mLabel(it.month)} – ${it.storeName}.`]);
      const again = await previewSheetBatch([{ storeId: it.storeId, tab: it.tab, month: it.month, scale: it.scale }]);
      if (again.items) setPv((list) => list?.map((x) => (keyOf(x.storeId, x.tab) === keyOf(it.storeId, it.tab) ? again.items![0] : x)) ?? null);
      router.refresh();
    });
  };

  const chip = (on: boolean, dis?: boolean) =>
    `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] ring-1 ${dis ? "cursor-not-allowed opacity-40 ring-line" : on ? "bg-ok-soft font-semibold text-good ring-secondary" : "bg-card ring-line-strong hover:bg-primary-light"}`;
  const nPicked = Object.keys(picks).length;

  return (
    <section className={`overflow-hidden rounded-2xl ${open ? "border-2 border-secondary bg-card" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex min-h-12 w-full items-center gap-3 bg-secondary px-4 py-2.5 text-left text-white ${open ? "" : "rounded-2xl"}`}>
        <Sheet size={20} aria-hidden />
        <span className="flex-1">
          <span className="block text-[15px] font-bold">Import tháng cũ từ Google Sheet</span>
          {!open && <span className="text-xs opacity-85">Nhiều cơ sở × nhiều tab tháng (T10-26, T10…) 1 lần → chốt ca từng ngày</span>}
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="space-y-4 p-4 text-sm">
          <p className="text-ink/70">
            Đọc sheet doanh thu của từng cơ sở (đúng các cột app đang ghi: DT máy, TK, TM, Thu chi, Shopee, Grab). Mỗi ngày có số → 1 lượt chốt <b>ca Tối</b> gắn nhãn “Import Google Sheet”.
            Không gửi Telegram, không tạo yêu cầu bù doanh thu, không ghi đè ngày đã có chốt ca trên app.
          </p>

          {/* Bước 1 – cơ sở */}
          <div className="space-y-2">
            <div className="text-xs font-bold text-ink/70">1. Chọn cơ sở</div>
            <div className="flex flex-wrap items-center gap-2">
              {stores.map((s) => {
                const on = selStores.includes(s.id);
                return (
                  <label key={s.id} className={chip(on)}>
                    <input type="checkbox" className="accent-secondary" checked={on} disabled={busy} onChange={() => setSelStores((l) => (on ? l.filter((x) => x !== s.id) : [...l, s.id]))} />
                    {s.name}
                  </label>
                );
              })}
              <button type="button" disabled={busy || !selStores.length} onClick={loadTabs} className="rounded-xl bg-secondary px-3 py-1.5 font-semibold text-white disabled:opacity-60">
                {Object.keys(tabsBy).length ? "Tải lại tab" : "Tải danh sách tab"}
              </button>
              {busy && <Loader2 size={18} className="animate-spin text-accent" aria-label="Đang xử lý" />}
            </div>
          </div>

          {/* Bước 2 – tab tháng của từng cơ sở */}
          {Object.keys(tabsBy).length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-ink/70">2. Chọn tab tháng cũ cần nhập ({nPicked} tab)</div>
              {Object.entries(tabsBy).map(([sid, st]) => (
                <div key={sid} className="rounded-xl bg-cream p-3 ring-1 ring-line">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <b className="flex-1">{storeName(sid)}</b>
                    {st.tabs && (
                      <>
                        <button type="button" className="text-xs text-accent underline" onClick={() => pickAllPast(sid, true)}>Chọn tất cả tháng cũ</button>
                        <button type="button" className="text-xs text-ink/60 underline" onClick={() => pickAllPast(sid, false)}>Bỏ chọn</button>
                      </>
                    )}
                  </div>
                  {st.error ? (
                    <p className="text-danger">{st.error}</p>
                  ) : !st.tabs?.length ? (
                    <p className="text-ink/60">Sheet không có tab nào.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {st.tabs.map((t) => {
                        const k = keyOf(sid, t.tab);
                        const on = k in picks;
                        const dis = !!t.month && !t.past; // tháng này / tương lai: app tự ghi
                        return (
                          <span key={t.tab} className="inline-flex items-center gap-1">
                            <label className={chip(on, dis)} title={dis ? "Tháng này – app tự ghi khi nhân viên chốt ca" : undefined}>
                              <input type="checkbox" className="accent-secondary" checked={on} disabled={busy || dis} onChange={() => togglePick(sid, t)} />
                              {t.tab}
                              {t.month && <span className="text-[11px] opacity-70">{mLabel(t.month)}</span>}
                            </label>
                            {on && !t.month && (
                              <input
                                type="month"
                                aria-label={`Tháng của tab ${t.tab}`}
                                className="rounded-lg border border-warn bg-card px-2 py-1 text-xs"
                                value={picks[k]}
                                max={st.cur ? prevMonth(st.cur) : undefined}
                                onChange={(e) => {
                                  setPv(null);
                                  setPicks((p) => ({ ...p, [k]: e.target.value }));
                                }}
                              />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {missingMonth > 0 && <p className="text-xs text-warn">{missingMonth} tab không đoán được tháng từ tên – chọn tháng ở ô bên cạnh tab (chưa chọn thì bỏ qua).</p>}
              <button type="button" disabled={busy || !items().length} onClick={preview} className="rounded-xl bg-secondary px-4 py-2 font-semibold text-white disabled:opacity-60">
                Xem trước {items().length} tab
              </button>
            </div>
          )}

          {error && <p className="rounded-xl bg-bad-bg px-3 py-2 text-danger">{error}</p>}
          {msg.length > 0 && (
            <ul className="space-y-0.5 rounded-xl bg-ok-bg px-3 py-2 text-good">
              {msg.map((m, i) => (
                <li key={i} className={m.startsWith("✕") ? "text-danger" : ""}>{m}</li>
              ))}
            </ul>
          )}

          {/* Bước 3 – xem trước & nhập */}
          {pv && (
            <div className="space-y-3">
              <div className="text-xs font-bold text-ink/70">3. Kiểm tra & nhập</div>
              <div className="overflow-auto rounded-xl ring-1 ring-line">
                <table className="w-full text-[13px]">
                  <thead className="bg-mute-bg text-xs">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Cơ sở · tab</th>
                      <th className="px-2 text-left">Tháng</th>
                      <th className="px-2 text-right">Sẽ nhập</th>
                      <th className="px-2 text-right">DT máy</th>
                      <th className="px-2 text-left">Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pv.map((it) => {
                      const k = keyOf(it.storeId, it.tab);
                      const rows = it.rows ?? [];
                      const todo = todoOf(it);
                      const skipped = rows.length - todo.length;
                      return (
                        <Fragment key={k}>
                          <tr className="border-t border-line align-top">
                            <td className="px-2 py-1.5">
                              <b>{it.storeName}</b> · {it.tab}
                            </td>
                            <td className="px-2 py-1.5">{mLabel(it.month)}</td>
                            <td className="px-2 py-1.5 text-right font-bold">{it.error ? "—" : `${todo.length} ngày`}</td>
                            <td className="px-2 py-1.5 text-right">{it.error ? "—" : vnd(todo.reduce((a, r) => a + r.revenue.dt, 0))}</td>
                            <td className="space-y-0.5 px-2 py-1.5 text-xs">
                              {it.error && <div className="text-danger">{it.error}</div>}
                              {!it.error && !rows.length && <div className="text-warn">Không có ngày nào có số (đọc từ dòng {it.firstRow})</div>}
                              {skipped > 0 && <div className="text-ink/60">bỏ qua {skipped} ngày đã có</div>}
                              {dupMonth(it) && <div className="text-warn">Trùng tháng với tab khác – tab sau sẽ bỏ qua ngày đã nhập</div>}
                              {it.thousands && it.scale !== 1000 && (
                                <div className="text-warn">
                                  Số có vẻ theo nghìn đồng.{" "}
                                  <button type="button" disabled={busy} className="font-semibold text-accent underline" onClick={() => rescale(it, 1000)}>Nhân 1.000</button>
                                </div>
                              )}
                              {it.scale === 1000 && (
                                <div>
                                  Đang nhân 1.000.{" "}
                                  <button type="button" disabled={busy} className="text-accent underline" onClick={() => rescale(it, 1)}>Bỏ nhân</button>
                                </div>
                              )}
                              <div className="flex flex-wrap gap-2">
                                {rows.length > 0 && (
                                  <button type="button" className="text-accent underline" onClick={() => setExpand((e) => (e === k ? null : k))}>
                                    {expand === k ? "Ẩn chi tiết" : "Xem từng ngày"}
                                  </button>
                                )}
                                {rows.some((r) => r.status === "imported") && (
                                  <button type="button" disabled={busy} className="text-danger underline" onClick={() => undo(it)}>Xoá đã import tháng này</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expand === k && (
                            <tr>
                              <td colSpan={5} className="bg-cream p-2">
                                <DayTable item={it} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-ink/70">
                Sẽ nhập <b>{totalDays}</b> ngày từ <b>{ready.length}</b> tab · DT máy <b>{vnd(totalDt)}</b>
              </p>
              {totalDays > 0 && (
                <label className="flex items-start gap-2 rounded-xl bg-primary-light px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={markTaken} onChange={(e) => setMarkTaken(e.target.checked)} />
                  <span>
                    <b>Tháng cũ – tiền đã lấy rồi:</b> đánh dấu <b>đã lấy tiền</b> + <b>đã đếm tiền</b> các ngày này, <b>không đưa tiền mặt / tài khoản vào Sổ quỹ</b>. Doanh thu, lãi lỗ,
                    báo cáo vẫn tính đủ.
                    {!markTaken && <span className="block text-warn">Bỏ tích → tiền mặt / tài khoản các ngày này sẽ CỘNG vào Sổ quỹ như doanh thu bình thường.</span>}
                  </span>
                </label>
              )}
              {totalDays > 0 && (
                <button type="button" disabled={busy} onClick={apply} className="inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2 font-semibold text-white disabled:opacity-60">
                  {busy && <Loader2 size={16} className="animate-spin" />} Nhập {totalDays} ngày ({ready.length} tab)
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DayTable({ item }: { item: BatchPreviewItem }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg bg-card ring-1 ring-line">
      <table className="w-full text-right text-[12px]">
        <thead className="sticky top-0 bg-mute-bg">
          <tr>
            <th className="px-2 py-1 text-left">Ngày</th>
            <th className="px-2">DT máy</th>
            <th className="px-2">TK</th>
            <th className="px-2">TM</th>
            <th className="px-2">Thu chi</th>
            <th className="px-2">Shopee</th>
            {item.layout !== "LEGACY" && <th className="px-2">Grab</th>}
            <th className="px-2 text-left">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {(item.rows ?? []).map((r) => (
            <tr key={r.date} className={`border-t border-line ${r.status === "new" ? "" : "opacity-50"}`} title={r.note || undefined}>
              <td className="px-2 py-0.5 text-left font-semibold">{dm(r.date)}</td>
              <td className="px-2">{vnd(r.revenue.dt)}</td>
              <td className="px-2">{vnd(r.revenue.tk)}</td>
              <td className="px-2">{vnd(r.revenue.tm)}</td>
              <td className="px-2">{vnd(r.revenue.cp)}</td>
              <td className="px-2">{vnd(r.revenue.shopee)}</td>
              {item.layout !== "LEGACY" && <td className="px-2">{vnd(r.revenue.grab)}</td>}
              <td className={`px-2 text-left ${ST[r.status][1]}`}>{ST[r.status][0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
