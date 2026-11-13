"use client";
import { useEffect, useState, useTransition } from "react";
import { Database, Eraser, Loader2, RefreshCw } from "lucide-react";
import { Alert, Button, Card, Field, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AUTO_KEYS_UI, CLEANUP_ITEMS, GROUP_LABEL, TTL_RULES, fmtBytes, type CleanupCounts, type CleanupItem, type CleanupKey } from "@/lib/cleanup-items";
import type { CleanupOpts, StorageStats } from "@/lib/cleanup";
import { cleanupData, loadStorageStats, previewAllCleanup, setAutoCleanup } from "../../actions/settings";

const vm = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const prevMonthOf = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};
const GROUPS = Object.keys(GROUP_LABEL) as CleanupItem["group"][];
const viTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", dateStyle: "short", timeStyle: "short" });

/** Admin Tổng: dọn dữ liệu rác theo tháng. Không đụng tới chấm công / lương / chi phí. */
export default function CleanupCard({
  months,
  safe,
  autoCleanup,
  lastAuto,
}: {
  months: string[];
  /** mốc an toàn: giữ tháng này + 2 tháng trước. Chọn mốc sau mốc này = xoá cả tháng trước / tháng này */
  safe: string;
  autoCleanup: boolean;
  lastAuto: { month: string; status: string; at: string | null; error: string | null } | null;
}) {
  const [opts, setOpts] = useState<CleanupOpts>(() => ({
    beforeMonth: safe,
    drivePhotos: false,
    ...Object.fromEntries(CLEANUP_ITEMS.map((i) => [i.key, i.on])),
  }));
  const [counts, setCounts] = useState<CleanupCounts | null>(null); // số lượng từng loại (tự đếm khi đổi tháng)
  const [counting, setCounting] = useState(false);
  const [preview, setPreview] = useState<CleanupCounts | null>(null);
  const [done, setDone] = useState<CleanupCounts | null>(null);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();
  const [ack, setAck] = useState(false); // xác nhận xoá cả dữ liệu tháng này / tháng trước
  const [auto, setAuto] = useState(autoCleanup);
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [statsErr, setStatsErr] = useState("");
  const [statsBusy, setStatsBusy] = useState(false);

  const recount = (m: string) => {
    setCounting(true);
    previewAllCleanup(m)
      .then((r) => (r.error ? setError(r.error) : setCounts(r.counts ?? null)))
      .finally(() => setCounting(false));
  };
  useEffect(() => recount(opts.beforeMonth), [opts.beforeMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<CleanupOpts>) => {
    if (patch.beforeMonth) setAck(false);
    setOpts((o) => ({ ...o, ...patch }));
    setPreview(null);
    setDone(null);
  };
  const call = (apply: boolean) =>
    start(async () => {
      setError("");
      const r = await cleanupData(opts, apply);
      if (r.error) return setError(r.error);
      if (apply) {
        setDone(r.counts ?? null);
        setPreview(null);
        setAsk(false);
        recount(opts.beforeMonth);
        if (stats) refreshStats();
      } else {
        setPreview(r.counts ?? null);
        setAsk(true);
      }
    });
  const refreshStats = () => {
    setStatsBusy(true);
    setStatsErr("");
    loadStorageStats()
      .then((r) => (r.error ? setStatsErr(r.error) : setStats(r.stats ?? null)))
      .finally(() => setStatsBusy(false));
  };
  const toggleAuto = (on: boolean) =>
    start(async () => {
      const r = await setAutoCleanup(on);
      if (r.error) setError(r.error);
      else setAuto(on);
    });

  const lines = (c: CleanupCounts) =>
    CLEANUP_ITEMS.flatMap((it) => {
      const p = c[it.key];
      if (!p || !p.total) return [];
      return [`${it.label}: ${p.parts.filter(([, n]) => n).map(([l, n]) => `${n.toLocaleString("vi-VN")} ${l}`).join(" · ")}`];
    }).concat(c.driveFolders ? [`${c.driveFolders} thư mục ảnh trên Drive đã chuyển vào thùng rác`] : []);
  const warns = (c: CleanupCounts) => CLEANUP_ITEMS.map((i) => c[i.key]?.warn).filter(Boolean) as string[];

  const check = (it: CleanupItem) => {
    const n = counts?.[it.key]?.total;
    return (
      <label key={it.key} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-secondary" checked={!!opts[it.key]} onChange={(e) => set({ [it.key]: e.target.checked } as Partial<CleanupOpts>)} />
        <span className="flex-1">
          {it.label}{" "}
          {counting && n == null ? (
            <Loader2 size={12} className="inline animate-spin text-ink/40" />
          ) : n != null ? (
            <span className={`text-xs font-semibold ${n ? "text-good" : "text-ink/40"}`}>({n.toLocaleString("vi-VN")})</span>
          ) : null}
          {it.hint && <span className="block text-xs text-ink/60">{it.hint}</span>}
        </span>
      </label>
    );
  };
  const selected = CLEANUP_ITEMS.filter((i) => opts[i.key]).reduce((s, i) => s + (counts?.[i.key]?.total ?? 0), 0);
  const danger = opts.beforeMonth > safe; // xoá cả dữ liệu đang dùng
  const cur = months[1]; // tháng hiện tại
  const monthLabel = (m: string) =>
    m > cur
      ? `⚠ Xoá cả tháng này (${vm(cur)})`
      : m === cur
        ? `⚠ Xoá đến hết tháng trước (${vm(prevMonthOf(m))}) – giữ tháng này`
        : m > safe
          ? `⚠ Trước ${vm(m)} (giữ từ ${vm(m)})`
          : `Trước ${vm(m)} (giữ từ ${vm(m)})${m === safe ? " · khuyên dùng" : ""}`;
  const pctUsed = stats ? Math.min(100, (stats.used / stats.limit) * 100) : 0;

  return (
    <Card title="Dọn dữ liệu cũ">
      <p className="mb-3 text-xs text-ink/70">
        Xoá dữ liệu không cần thiết để nhẹ database. <b>Không xoá</b> bảng chấm công, ca làm chính thức, thưởng/phạt, bảng lương, chi phí. Mặc định giữ tháng này + 2 tháng trước; có thể chọn
        xoá cả tháng trước / tháng này (cần xác nhận). Dữ liệu mồ côi & ảnh bị kẹt thì xoá ở mọi tháng.
      </p>

      {/* Dung lượng */}
      <div className="mb-4 rounded-xl border border-ink/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Database size={16} /> Dung lượng database
          </span>
          <Button variant="ghost" className="px-2 py-1 text-xs" disabled={statsBusy} onClick={refreshStats}>
            {statsBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} {stats ? "Làm mới" : "Xem dung lượng"}
          </Button>
        </div>
        {statsErr && <p className="mt-1 text-xs text-danger">{statsErr}</p>}
        {stats && (
          <div className="mt-2 space-y-2">
            <div className="h-2.5 overflow-hidden rounded-full bg-shade/10">
              <div className={`h-full ${pctUsed > 80 ? "bg-danger" : pctUsed > 60 ? "bg-warn" : "bg-secondary"}`} style={{ width: `${Math.max(pctUsed, 1)}%` }} />
            </div>
            <p className="text-xs text-ink/70">
              Đang dùng <b>{fmtBytes(stats.used)}</b> / {fmtBytes(stats.limit)} ({pctUsed.toFixed(1)}%) · dữ liệu {fmtBytes(stats.dataSize)} + index {fmtBytes(stats.indexSize)}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink/60">
                  <th className="py-0.5 font-medium">Bảng nặng nhất</th>
                  <th className="py-0.5 text-right font-medium">Bản ghi</th>
                  <th className="py-0.5 text-right font-medium">Dung lượng</th>
                </tr>
              </thead>
              <tbody>
                {stats.collections.slice(0, 6).map((c) => (
                  <tr key={c.name} className="border-t border-ink/5">
                    <td className="py-0.5">{c.name}</td>
                    <td className="py-0.5 text-right tabular-nums">{c.count.toLocaleString("vi-VN")}</td>
                    <td className="py-0.5 text-right tabular-nums">{c.size || c.indexSize ? fmtBytes(c.size + c.indexSize) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <Field label="Phạm vi xoá">
          <Select value={opts.beforeMonth} onChange={(e) => set({ beforeMonth: e.target.value })} className={`sm:!w-96 ${danger ? "!border-danger text-danger" : ""}`}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
        </Field>
        {danger && (
          <Alert tone="red">
            <b>Đang chọn xoá cả dữ liệu {opts.beforeMonth > cur ? `tháng này (${vm(cur)})` : `tháng trước (${vm(prevMonthOf(cur))})`}</b> – tháng còn đang tính lương / đối soát.
            Xoá <b>chốt ca &amp; doanh thu từng ca</b> sẽ làm mất số liệu Doanh thu theo ngày, Lãi lỗ, báo cáo của những ngày đó (Google Sheet vẫn giữ tổng ngày đã ghi);
            xoá <b>ảnh</b> thì không xem lại được ảnh chấm công / chốt ca. Đơn & ca của các ngày sắp tới vẫn được giữ.
            <label className="mt-2 flex items-center gap-2 font-semibold">
              <input type="checkbox" className="accent-danger" checked={ack} onChange={(e) => setAck(e.target.checked)} /> Tôi hiểu, vẫn muốn xoá
            </label>
          </Alert>
        )}
        {GROUPS.map((g) => (
          <div key={g}>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink/50">{GROUP_LABEL[g]}</p>
            <div className="grid gap-2 sm:grid-cols-2">{CLEANUP_ITEMS.filter((i) => i.group === g).map(check)}</div>
            {g === "photo" && opts.photos && (
              <div className="mt-2 rounded-xl bg-cream p-2">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 accent-secondary" checked={!!opts.drivePhotos} onChange={(e) => set({ drivePhotos: e.target.checked })} />
                  <span>
                    Xoá cả thư mục ảnh tháng cũ trên Google Drive
                    <span className="block text-xs text-ink/60">Chuyển vào thùng rác Drive – khôi phục được trong 30 ngày</span>
                  </span>
                </label>
              </div>
            )}
          </div>
        ))}
        {error && <Alert tone="red">{error}</Alert>}
        {done && (
          <Alert tone="green">
            <b>Đã dọn xong:</b>
            {lines(done).length ? (
              <ul className="list-disc pl-5">
                {lines(done).map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p>Không có gì cần dọn.</p>
            )}
            {!!done.driveRemaining && <p className="mt-1 text-warn">Còn {done.driveRemaining} thư mục trên Drive chưa kịp xoá – bấm dọn lần nữa.</p>}
          </Alert>
        )}
        <Button variant="danger" disabled={pending || (danger && !ack)} onClick={() => call(false)}>
          {pending && !ask ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />} Dọn dữ liệu…{counts && !counting ? ` (${selected.toLocaleString("vi-VN")} mục)` : ""}
        </Button>
      </div>

      {/* Tự động */}
      <div className="mt-4 space-y-2 rounded-xl bg-cream p-3 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" className="mt-1 accent-secondary" checked={auto} disabled={pending} onChange={(e) => toggleAuto(e.target.checked)} />
          <span>
            <b>Tự dọn mỗi tháng</b>
            <span className="block text-xs text-ink/60">
              Đầu mỗi tháng tự xoá các loại an toàn ({CLEANUP_ITEMS.filter((i) => AUTO_KEYS_UI.includes(i.key)).map((i) => i.label.toLowerCase()).join(", ")}) của dữ liệu cũ hơn 2 tháng, rồi báo
              kết quả + dung lượng vào nhóm Telegram Quản lý doanh thu. Ảnh, chốt ca, tài khoản, thiết bị vẫn phải dọn tay.
            </span>
          </span>
        </label>
        {lastAuto && (
          <p className="text-xs text-ink/60">
            Lần tự dọn gần nhất: tháng {vm(lastAuto.month)}
            {lastAuto.at && ` · ${viTime(lastAuto.at)}`} · {lastAuto.status === "SENT" ? "thành công" : <span className="text-danger">lỗi: {lastAuto.error}</span>}
          </p>
        )}
        <p className="text-xs text-ink/60">
          Luôn tự xoá theo thời gian (không cần bật): {TTL_RULES.map((r) => `${r.label.toLowerCase()} sau ${r.days} ngày`).join(" · ")}.
        </p>
      </div>

      <ConfirmDialog
        open={ask && !!preview}
        danger
        title={`${monthLabel(opts.beforeMonth).replace("⚠ ", "").replace(/ · khuyên dùng$/, "")}?`}
        confirmLabel="Xoá vĩnh viễn"
        busy={pending}
        onCancel={() => setAsk(false)}
        onConfirm={() => call(true)}
      >
        {preview && (
          <>
            {lines(preview).length ? (
              <>
                <p>Sẽ xoá / cập nhật:</p>
                <ul className="list-disc pl-5">
                  {lines(preview).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p>Không có dữ liệu nào cần dọn với lựa chọn này.</p>
            )}
            {opts.photos && opts.drivePhotos && <p>+ các thư mục ảnh tháng cũ trên Google Drive (vào thùng rác).</p>}
            {warns(preview).map((w) => (
              <p key={w} className="font-semibold text-warn">
                ⚠ {w}
              </p>
            ))}
            <p className="font-semibold text-danger">Dữ liệu trong database không khôi phục được.</p>
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
