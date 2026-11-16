"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, FileSpreadsheet, Loader2 } from "lucide-react";
import { applyRevenueImport, previewRevenueImport, undoRevenueImport, type ApplyResult, type ImportPreview } from "../../actions/revenue-import";

const vnd = (n?: number | null) => (n == null ? "—" : n.toLocaleString("vi-VN"));
const sgn = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("vi-VN")}`;
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

/**
 * Chốt ca → Import doanh thu máy từ báo cáo KiotViet "Bán hàng theo thời gian" (.xlsx / .xls / .pdf).
 * 1) chọn file + tuỳ chọn → 2) so sánh với DT máy đang có của ca Tối (chưa ghi) → 3) cập nhật / hoàn tác.
 */
export default function ImportRevenue({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [done, setDone] = useState<(ApplyResult & { storeId: string }) | null>(null);
  const [showSame, setShowSame] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const preview = () => {
    const fd = new FormData(formRef.current!);
    setError("");
    setDone(null);
    start(async () => {
      const r = await previewRevenueImport(fd).catch(() => ({ error: "Mất kết nối – thử lại" }) as ImportPreview);
      if (r.error) setError(r.error);
      else setPv(r);
    });
  };
  const toUpdate = pv?.rows?.filter((r) => r.status === "update") ?? [];
  const apply = () => {
    if (!pv?.storeId) return;
    start(async () => {
      const r = await applyRevenueImport(
        pv.storeId!,
        toUpdate.map((x) => ({ closingId: x.closingId!, date: x.date, dt: x.dt })),
        pv.fileName ?? "",
      ).catch(() => ({ error: "Mất kết nối – thử lại" }) as ApplyResult);
      if (r.error) setError(r.error);
      else {
        setDone({ ...r, storeId: pv.storeId! });
        setPv(null);
        router.refresh();
      }
    });
  };
  const undo = () => {
    if (!done?.updated?.length) return;
    start(async () => {
      const r = await undoRevenueImport(done.storeId, done.updated!).catch(() => ({ error: "Mất kết nối – thử lại" }) as ApplyResult);
      if (r.error) setError(r.error);
      else {
        setDone(null);
        router.refresh();
      }
    });
  };

  const count = (s: string) => pv?.rows?.filter((r) => r.status === s).length ?? 0;
  const curSum = toUpdate.reduce((s, r) => s + (r.cur ?? 0), 0);
  const newSum = toUpdate.reduce((s, r) => s + r.dt, 0);

  return (
    <section className={`overflow-hidden rounded-2xl ${open ? "border-2 border-accent bg-card" : ""}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`flex min-h-12 w-full items-center gap-3 bg-accent px-4 py-2.5 text-left text-on-accent ${open ? "" : "rounded-2xl"}`}>
        <FileSpreadsheet size={20} aria-hidden />
        <span className="flex-1">
          <span className="block text-[15px] font-bold">Import doanh thu máy (KiotViet)</span>
          {!open && <span className="text-xs opacity-85">File .xlsx / .xls / .pdf “Báo cáo bán hàng theo thời gian” → DT máy ca Tối từng ngày</span>}
        </span>
        {open ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
      </button>
      {open && (
        <div className="space-y-3 p-4 text-sm">
          {!pv && !done && (
            <form ref={formRef} onSubmit={(e) => (e.preventDefault(), preview())} className="space-y-3">
              <p className="text-ink/70">
                App lấy cột <b>Thời gian</b> + <b>Doanh thu</b>, ghi vào <b>DT máy của ca Tối</b> (ca cuối ngày). Doanh thu ngày bên Tài chính tự tính lại theo; ngày thiếu tiền
                tự có <b>yêu cầu bù doanh thu</b> gửi admin.
              </p>
              <input type="file" name="file" required accept=".xls,.xlsx,.csv,.pdf,.htm,.html" className="block w-full rounded-xl bg-card p-2 ring-1 ring-line-strong" />
              <label className="flex flex-col gap-1 font-semibold">
                Ghi vào cơ sở
                <select name="storeId" className="h-11 rounded-xl bg-card px-2 font-normal ring-1 ring-line-strong">
                  <option value="">Tự nhận theo “Chi nhánh” trong file</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="space-y-2 rounded-xl p-3 ring-1 ring-line">
                <legend className="px-1 font-semibold text-accent">Tuỳ chọn</legend>
                <label className="flex items-start gap-2">
                  <input type="checkbox" name="includeToday" className="mt-1 h-4 w-4" />
                  <span>
                    <b>Cập nhật cả hôm nay</b>
                    <span className="block text-xs text-ink/60">Mặc định bỏ qua – hôm nay chưa hết ngày, có thể chưa chốt ca Tối.</span>
                  </span>
                </label>
                <div>
                  <span className="text-xs font-semibold">Ngày chưa có chốt ca Tối</span>
                  <label className="flex items-center gap-2"><input type="radio" name="missing" value="skip" defaultChecked /> Bỏ qua, chỉ báo trong kết quả</label>
                  <label className="flex items-center gap-2"><input type="radio" name="missing" value="latest" /> Ghi vào ca chốt gần nhất của ngày đó</label>
                </div>
              </fieldset>
              <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-bold text-on-primary disabled:opacity-70">
                {busy && <Loader2 size={18} className="animate-spin" aria-hidden />} Xem so sánh trước khi cập nhật
              </button>
              <p className="text-center text-xs text-ink/60">Chưa ghi gì cho tới khi bấm Cập nhật ở bước sau.</p>
            </form>
          )}

          {pv && (
            <div className="space-y-3">
              <div className="rounded-xl bg-warn-soft px-3 py-2 text-[13px]">
                <b>{pv.fileName}</b> · {pv.days} ngày{pv.from ? ` · kỳ ${dm(pv.from)} – ${dm(pv.to ?? pv.from)}` : ""}
                {pv.total != null && ` · tổng ${vnd(pv.total)}`}
                <span className="block">
                  Chi nhánh trong file: <b>{pv.branch || "?"}</b> → {pv.storeId ? <b>{stores.find((s) => s.id === pv.storeId)?.name}</b> : <b className="text-danger">chưa nhận được cơ sở</b>}
                  {pv.storeMatched && " (tự nhận)"}
                </span>
              </div>
              {!pv.storeId ? (
                <p className="rounded-xl bg-bad-soft px-3 py-2 text-bad-fg ring-1 ring-bad-line">Không khớp được cơ sở theo tên chi nhánh – quay lại chọn cơ sở.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-late-bg p-2"><p className="text-xs">Sẽ cập nhật</p><p className="text-xl font-bold text-late-fg">{count("update")} ngày</p></div>
                    <div className="rounded-xl bg-ok-bg p-2"><p className="text-xs">Khớp, giữ nguyên</p><p className="text-xl font-bold text-good">{count("same")} ngày</p></div>
                    <div className="rounded-xl bg-bad-bg p-2"><p className="text-xs">Chưa có chốt ca Tối</p><p className="text-xl font-bold text-bad-fg">{count("noEvening")} ngày</p></div>
                    <div className="rounded-xl bg-mute-bg p-2"><p className="text-xs">Hôm nay – bỏ qua</p><p className="text-xl font-bold text-mute-fg">{count("today")} ngày</p></div>
                  </div>
                  {toUpdate.length > 0 && (
                    <p className="rounded-xl bg-warn-soft px-3 py-2 text-[13px]">
                      Tổng DT máy {toUpdate.length} ngày cập nhật: <b>{vnd(newSum)}</b> (đang có {vnd(curSum)}) → <b className="text-late-fg">chênh {sgn(newSum - curSum)}</b>
                    </p>
                  )}
                  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> Hiện cả các ngày khớp</label>
                  <div className="overflow-hidden rounded-xl ring-1 ring-line">
                    <div className="grid grid-cols-[52px_1fr_1fr_84px] bg-primary text-xs font-semibold text-on-primary">
                      <span className="p-2">Ngày</span><span className="p-2 text-right">File KiotViet</span><span className="p-2 text-right">Đang có</span><span className="p-2 text-right">Chênh</span>
                    </div>
                    {pv.rows!.filter((r) => showSame || r.status !== "same").map((r) => (
                      <div key={r.date} className={`border-b border-line text-[13px] ${r.status === "update" ? "bg-warn-soft" : r.status === "noEvening" ? "bg-bad-soft" : r.status === "today" ? "bg-mute-bg" : ""}`}>
                        <div className="grid grid-cols-[52px_1fr_1fr_84px] items-center">
                          <span className="p-2 font-semibold">{dm(r.date)}</span>
                          <span className="p-2 text-right font-semibold">{vnd(r.dt)}</span>
                          <span className="p-2 text-right text-ink/70">{r.status === "noEvening" ? "—" : r.cur == null ? "chưa nhập" : vnd(r.cur)}</span>
                          <span className="p-2 text-right font-bold text-late-fg">{r.status === "update" ? sgn(r.dt - (r.cur ?? 0)) : r.status === "same" ? "0" : ""}</span>
                        </div>
                        <p className="px-2 pb-2 pl-[60px] text-xs text-ink/70">
                          {r.status === "update"
                            ? `Sẽ cập nhật ca ${r.shiftName ?? ""}${r.who ? ` (${r.who})` : ""}${r.cur == null ? " – chưa có DT máy → điền mới" : ""}`
                            : r.status === "noEvening"
                              ? "Chưa có chốt ca Tối → bỏ qua"
                              : r.status === "today"
                                ? "Hôm nay – bỏ qua (chưa tích Cập nhật cả hôm nay)"
                                : "Khớp – giữ nguyên"}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="rounded-xl bg-info-soft px-3 py-2 text-[13px] text-info-fg">
                    <b>Doanh thu ngày (Tài chính)</b> tự tính lại cho các ngày cập nhật; ngày đã ghi Google Sheet sẽ ghi lại. Ngày nào sau cập nhật THIẾU tiền → tự tạo yêu cầu
                    bù doanh thu cho admin duyệt.
                  </p>
                </>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setPv(null)} className="h-11 rounded-xl px-4 font-semibold text-accent ring-1 ring-line-strong">‹ Quay lại</button>
                <button type="button" onClick={apply} disabled={busy || !toUpdate.length} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-on-primary disabled:opacity-60">
                  {busy && <Loader2 size={16} className="animate-spin" aria-hidden />} {toUpdate.length ? `Cập nhật ${toUpdate.length} ngày` : "Không có ngày nào cần cập nhật"}
                </button>
              </div>
            </div>
          )}

          {done && (
            <div className="space-y-2 rounded-xl p-3 ring-2 ring-good">
              <p className="font-bold text-good">✓ Đã cập nhật doanh thu máy {done.updated?.length ?? 0} ngày</p>
              <ul className="text-[13px]">
                {done.updated?.map((u) => (
                  <li key={u.date}>
                    {dm(u.date)} · {u.prev == null ? "chưa nhập" : vnd(u.prev)} → <b>{vnd(u.dt)}</b> {u.prev != null && <span className="text-late-fg">({sgn(u.dt - u.prev)})</span>}
                  </li>
                ))}
              </ul>
              {!!done.gaps?.length && (
                <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad-fg">
                  💸 {done.gaps.length} ngày thiếu tiền đã có yêu cầu bù doanh thu: {done.gaps.map((g) => `${dm(g.date)} (${sgn(g.total)})`).join(", ")} –{" "}
                  <Link href="/admin/requests#bu-doanh-thu" className="underline">xem ở Yêu cầu</Link>
                </p>
              )}
              <div className="flex gap-2">
                <Link href="/admin/finance/revenue" className="flex h-10 flex-1 items-center justify-center rounded-xl bg-primary font-bold text-on-primary">Xem Doanh thu ngày</Link>
                <button type="button" onClick={undo} disabled={busy} className="h-10 rounded-xl px-4 font-semibold text-accent ring-1 ring-line-strong">Hoàn tác</button>
                <button type="button" onClick={() => setDone(null)} className="h-10 rounded-xl px-3 text-ink/70">Import file khác</button>
              </div>
            </div>
          )}
          {error && <p role="alert" className="rounded-xl bg-bad-soft px-3 py-2 text-bad-fg ring-1 ring-bad-line">{error}</p>}
        </div>
      )}
    </section>
  );
}
