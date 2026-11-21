"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Sheet } from "lucide-react";
import { applySheetImport, previewSheetImport, sheetImportTabs, undoSheetImport, type SheetPreview, type SheetTab } from "../../actions/sheet-import";

const vnd = (n?: number | null) => (n ? n.toLocaleString("vi-VN") : "—");
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const mLabel = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const ST = { new: ["Sẽ nhập", "text-good"], exists: ["Đã có chốt ca trên app – bỏ qua", "text-ink/50"], imported: ["Đã import – bỏ qua", "text-ink/50"] } as const;

/**
 * Chốt ca → Import từ Google Sheet: doanh thu THÁNG CŨ trên sheet cơ sở (tab T10-26 / T10…) → chốt ca Tối từng ngày.
 * Mặc định đánh dấu đã lấy + đã đếm tiền, không đưa TM / TK vào Sổ quỹ (tiền đã lấy rồi).
 */
export default function ImportSheet({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [storeId, setStoreId] = useState("");
  const [tabs, setTabs] = useState<SheetTab[] | null>(null);
  const [cur, setCur] = useState("");
  const [tab, setTab] = useState("");
  const [month, setMonth] = useState("");
  const [scale, setScale] = useState(1);
  const [markTaken, setMarkTaken] = useState(true);
  const [pv, setPv] = useState<SheetPreview | null>(null);

  const run = (f: () => Promise<void>) => {
    setError("");
    setMsg("");
    start(async () => {
      try {
        await f();
      } catch {
        setError("Mất kết nối – thử lại");
      }
    });
  };

  const pickStore = (id: string) => {
    setStoreId(id);
    setTabs(null);
    setTab("");
    setMonth("");
    setPv(null);
    if (!id) return;
    run(async () => {
      const r = await sheetImportTabs(id);
      if (r.error) return setError(r.error);
      setTabs(r.tabs ?? []);
      setCur(r.curMonth ?? "");
    });
  };

  const preview = (t = tab, m = month, sc = scale) => {
    if (!storeId || !t || !m) return;
    setPv(null);
    run(async () => {
      const r = await previewSheetImport({ storeId, tab: t, month: m, scale: sc });
      if (r.error) return setError(r.error);
      setPv(r);
    });
  };

  const pickTab = (t: string) => {
    setTab(t);
    const m = tabs?.find((x) => x.tab === t)?.month ?? "";
    setMonth(m);
    setScale(1);
    setPv(null);
    if (m) preview(t, m, 1);
  };

  const rows = pv?.rows ?? [];
  const todo = rows.filter((r) => r.status === "new");
  const imported = rows.some((r) => r.status === "imported");
  const sum = (k: "dt" | "tm" | "tk") => todo.reduce((s, r) => s + r.revenue[k], 0);
  const storeName = stores.find((s) => s.id === storeId)?.name ?? "";

  const apply = () =>
    run(async () => {
      const r = await applySheetImport({ storeId, tab, month, scale, markTaken });
      if (r.error) return setError(r.error);
      setMsg(`Đã nhập ${r.created} ngày tháng ${mLabel(month)} – ${storeName}${r.skipped ? ` (bỏ qua ${r.skipped} ngày đã có)` : ""}.`);
      setPv(null);
      router.refresh();
    });

  const undo = () => {
    if (!window.confirm(`Xoá toàn bộ dữ liệu đã import từ sheet tháng ${mLabel(month)} – ${storeName}? Chốt ca thật trên app không bị ảnh hưởng.`)) return;
    run(async () => {
      const r = await undoSheetImport({ storeId, month });
      if (r.error) return setError(r.error);
      setMsg(`Đã xoá ${r.skipped} ngày đã import tháng ${mLabel(month)}.`);
      preview();
      router.refresh();
    });
  };

  const sel = "rounded-xl border border-line-strong bg-card px-3 py-2 text-sm";

  return (
    <section className={`overflow-hidden rounded-2xl ${open ? "border-2 border-secondary bg-card" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex min-h-12 w-full items-center gap-3 bg-secondary px-4 py-2.5 text-left text-white ${open ? "" : "rounded-2xl"}`}>
        <Sheet size={20} aria-hidden />
        <span className="flex-1">
          <span className="block text-[15px] font-bold">Import tháng cũ từ Google Sheet</span>
          {!open && <span className="text-xs opacity-85">Doanh thu các tháng trước app (tab T10-26, T10…) → chốt ca từng ngày</span>}
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="space-y-3 p-4 text-sm">
          <p className="text-ink/70">
            Đọc sheet doanh thu của cơ sở (đúng các cột app đang ghi: DT máy, TK, TM, Thu chi, Shopee, Grab). Mỗi ngày có số → 1 lượt chốt <b>ca Tối</b> gắn nhãn “Import Google Sheet”.
            Không gửi Telegram, không tạo yêu cầu bù doanh thu, không ghi đè ngày đã có chốt ca trên app.
          </p>

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-ink/70">Cơ sở</span>
              <select className={sel} value={storeId} onChange={(e) => pickStore(e.target.value)} disabled={busy}>
                <option value="">– Chọn cơ sở –</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            {tabs && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink/70">Tab tháng trên sheet</span>
                <select className={sel} value={tab} onChange={(e) => pickTab(e.target.value)} disabled={busy}>
                  <option value="">– Chọn tab –</option>
                  {tabs.map((t) => (
                    <option key={t.tab} value={t.tab} disabled={!!t.month && !t.past}>
                      {t.tab}
                      {t.month ? ` (tháng ${mLabel(t.month)}${t.past ? "" : " – tháng này, app tự ghi"})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-ink/70">Là tháng</span>
                <input
                  type="month"
                  className={sel}
                  value={month}
                  max={cur ? prevMonth(cur) : undefined}
                  onChange={(e) => {
                    setMonth(e.target.value);
                    preview(tab, e.target.value);
                  }}
                  disabled={busy}
                />
              </label>
            )}
            {busy && <Loader2 size={20} className="mb-2 animate-spin text-accent" aria-label="Đang xử lý" />}
          </div>
          {tab && !month && <p className="text-xs text-warn">Không đoán được tháng từ tên tab “{tab}” – chọn tháng ở ô “Là tháng”.</p>}

          {error && <p className="rounded-xl bg-bad-bg px-3 py-2 text-danger">{error}</p>}
          {msg && <p className="rounded-xl bg-ok-bg px-3 py-2 text-good">{msg}</p>}

          {pv && (
            <div className="space-y-3">
              {pv.thousands && scale === 1 && (
                <div className="rounded-xl bg-warn-soft px-3 py-2">
                  Số trên sheet có vẻ ghi theo <b>nghìn đồng</b> (VD 1.250 = 1.250.000đ).{" "}
                  <button type="button" className="font-semibold text-accent underline" onClick={() => (setScale(1000), preview(tab, month, 1000))}>
                    Nhân 1.000
                  </button>
                </div>
              )}
              {scale === 1000 && (
                <p className="text-xs text-ink/60">
                  Đang nhân 1.000.{" "}
                  <button type="button" className="text-accent underline" onClick={() => (setScale(1), preview(tab, month, 1))}>
                    Bỏ nhân
                  </button>
                </p>
              )}
              {!rows.length ? (
                <p className="rounded-xl bg-mute-bg px-3 py-2">
                  Tab này không có ngày nào có số (đọc từ dòng {pv.firstRow}, mẫu cột {pv.layout === "LEGACY" ? "cũ" : "có cột Grab"}). Kiểm tra lại tab / cài đặt sheet của cơ sở.
                </p>
              ) : (
                <>
                  <div className="max-h-96 overflow-auto rounded-xl ring-1 ring-line">
                    <table className="w-full text-right text-[13px]">
                      <thead className="sticky top-0 bg-mute-bg text-xs">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Ngày</th>
                          <th className="px-2">DT máy</th>
                          <th className="px-2">TK</th>
                          <th className="px-2">TM</th>
                          <th className="px-2">Thu chi</th>
                          <th className="px-2">Shopee</th>
                          {pv.layout !== "LEGACY" && <th className="px-2">Grab</th>}
                          <th className="px-2 text-left">Trạng thái</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.date} className={`border-t border-line ${r.status === "new" ? "" : "opacity-50"}`} title={r.note || undefined}>
                            <td className="px-2 py-1 text-left font-semibold">{dm(r.date)}</td>
                            <td className="px-2">{vnd(r.revenue.dt)}</td>
                            <td className="px-2">{vnd(r.revenue.tk)}</td>
                            <td className="px-2">{vnd(r.revenue.tm)}</td>
                            <td className="px-2">{vnd(r.revenue.cp)}</td>
                            <td className="px-2">{vnd(r.revenue.shopee)}</td>
                            {pv.layout !== "LEGACY" && <td className="px-2">{vnd(r.revenue.grab)}</td>}
                            <td className={`px-2 text-left text-xs ${ST[r.status][1]}`}>{ST[r.status][0]}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-ink/70">
                    Sẽ nhập <b>{todo.length}</b> ngày · DT máy <b>{vnd(sum("dt"))}</b> · TM {vnd(sum("tm"))} · TK {vnd(sum("tk"))}
                    {rows.length > todo.length ? ` · bỏ qua ${rows.length - todo.length} ngày` : ""}
                  </p>
                  {todo.length > 0 && (
                    <label className="flex items-start gap-2 rounded-xl bg-primary-light px-3 py-2">
                      <input type="checkbox" className="mt-1" checked={markTaken} onChange={(e) => setMarkTaken(e.target.checked)} />
                      <span>
                        <b>Tháng cũ – tiền đã lấy rồi:</b> đánh dấu <b>đã lấy tiền</b> + <b>đã đếm tiền</b> các ngày này, <b>không đưa tiền mặt / tài khoản vào Sổ quỹ</b>. Doanh thu,
                        lãi lỗ, báo cáo vẫn tính đủ.
                        {!markTaken && <span className="block text-warn">Bỏ tích → tiền mặt / tài khoản các ngày này sẽ CỘNG vào Sổ quỹ như doanh thu bình thường.</span>}
                      </span>
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {todo.length > 0 && (
                      <button type="button" disabled={busy} onClick={apply} className="rounded-xl bg-secondary px-4 py-2 font-semibold text-white disabled:opacity-60">
                        Nhập {todo.length} ngày tháng {mLabel(month)}
                      </button>
                    )}
                    {imported && (
                      <button type="button" disabled={busy} onClick={undo} className="rounded-xl px-4 py-2 font-semibold text-danger ring-1 ring-danger disabled:opacity-60">
                        Xoá dữ liệu đã import tháng này
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
