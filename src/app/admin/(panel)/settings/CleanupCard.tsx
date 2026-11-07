"use client";
import { useState, useTransition } from "react";
import { Eraser, Loader2 } from "lucide-react";
import { Alert, Button, Card, Field, Select } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { CleanupCounts, CleanupOpts } from "@/lib/cleanup";
import { cleanupData } from "../../actions/settings";

const vm = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;

/** Chủ: dọn dữ liệu rác theo tháng (log, ảnh cũ). Không đụng tới chấm công / lương. */
export default function CleanupCard({ months }: { months: string[] }) {
  const [opts, setOpts] = useState<CleanupOpts>({
    beforeMonth: months[0],
    loginLogs: true,
    auditLogs: true,
    adjustLogs: false,
    photos: true,
    drivePhotos: false,
    closings: true,
  });
  const [preview, setPreview] = useState<CleanupCounts | null>(null);
  const [done, setDone] = useState<CleanupCounts | null>(null);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(false);
  const [pending, start] = useTransition();

  const set = (patch: Partial<CleanupOpts>) => {
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
      } else {
        setPreview(r.counts ?? null);
        setAsk(true);
      }
    });

  const lines = (c: CleanupCounts) =>
    [
      opts.loginLogs && `${c.loginLogs + c.adminLoginLogs} lượt đăng nhập (NV ${c.loginLogs} · admin ${c.adminLoginLogs})`,
      opts.auditLogs && `${c.auditLogs} dòng nhật ký thao tác`,
      opts.adjustLogs && `${c.adjustLogs} dòng lịch sử sửa chấm công`,
      opts.photos && `Ảnh của ${c.attendancePhotos} lượt chấm công · ${c.closingPhotos} lượt chốt ca · ${c.pendingPhotos} ảnh tạm trong database`,
      opts.closings && c.closings != null && `${c.closings} lượt chốt ca + ${c.dayRevenues ?? 0} ngày doanh thu`,
      c.driveFolders != null && `${c.driveFolders} thư mục ảnh trên Drive đã chuyển vào thùng rác`,
    ].filter(Boolean) as string[];
  const check = (k: keyof CleanupOpts, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={!!opts[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<CleanupOpts>)} />
      <span>
        {label}
        {hint && <span className="block text-xs text-ink/60">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Card title="Dọn dữ liệu cũ">
      <p className="mb-3 text-xs text-ink/70">
        Xoá dữ liệu không cần thiết để nhẹ database. <b>Không xoá</b> bảng chấm công, ca làm, thưởng/phạt, bảng lương. Chỉ xoá được dữ liệu cũ hơn 2 tháng.
      </p>
      <div className="space-y-3">
        <Field label="Xoá dữ liệu TRƯỚC tháng">
          <Select value={opts.beforeMonth} onChange={(e) => set({ beforeMonth: e.target.value })} className="w-56">
            {months.map((m) => (
              <option key={m} value={m}>{vm(m)} (giữ từ {vm(m)} trở đi)</option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          {check("loginLogs", "Lịch sử đăng nhập", "Nhân viên + admin")}
          {check("auditLogs", "Nhật ký thao tác admin")}
          {check("adjustLogs", "Lịch sử sửa chấm công", "Ai sửa giờ, lúc nào – nên giữ nếu còn đối soát")}
          {check("photos", "Ảnh check-in / check-out & chốt ca", "Bỏ liên kết ảnh + xoá ảnh tạm trong database")}
          {check("closings", "Thông tin chốt ca & doanh thu từng ca", "Tổng ngày đã ghi lên Google Sheet nên không cần giữ")}
        </div>
        {opts.photos && (
          <div className="rounded-xl bg-cream p-2">
            {check("drivePhotos", "Xoá cả thư mục ảnh tháng cũ trên Google Drive", "Chuyển vào thùng rác Drive – khôi phục được trong 30 ngày")}
          </div>
        )}
        {error && <Alert tone="red">{error}</Alert>}
        {done && (
          <Alert tone="green">
            <b>Đã dọn xong:</b>
            <ul className="list-disc pl-5">{lines(done).map((l) => <li key={l}>{l}</li>)}</ul>
            {!!done.driveRemaining && <p className="mt-1 text-warn">Còn {done.driveRemaining} thư mục trên Drive chưa kịp xoá – bấm dọn lần nữa.</p>}
          </Alert>
        )}
        <Button variant="danger" disabled={pending} onClick={() => call(false)}>
          {pending && !ask ? <Loader2 size={16} className="animate-spin" /> : <Eraser size={16} />} Dọn dữ liệu…
        </Button>
      </div>

      <ConfirmDialog
        open={ask && !!preview}
        danger
        title={`Xoá dữ liệu trước tháng ${vm(opts.beforeMonth)}?`}
        confirmLabel="Xoá vĩnh viễn"
        busy={pending}
        onCancel={() => setAsk(false)}
        onConfirm={() => call(true)}
      >
        {preview && (
          <>
            <p>Sẽ xoá:</p>
            <ul className="list-disc pl-5">{lines(preview).map((l) => <li key={l}>{l}</li>)}</ul>
            {opts.photos && opts.drivePhotos && <p>+ các thư mục ảnh tháng cũ trên Google Drive (vào thùng rác).</p>}
            {!!preview.unsyncedDays && (
              <p className="font-semibold text-warn">⚠ {preview.unsyncedDays} ngày doanh thu CHƯA ghi được lên Google Sheet – xoá là mất số liệu các ngày này. Nên vào mục Chốt ca bấm “Ghi sheet” trước.</p>
            )}
            <p className="font-semibold text-danger">Dữ liệu trong database không khôi phục được.</p>
          </>
        )}
      </ConfirmDialog>
    </Card>
  );
}
