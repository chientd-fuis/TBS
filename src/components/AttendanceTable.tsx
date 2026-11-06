import type { ReactNode } from "react";
import { formatDuration } from "@/lib/calc";
import { hoursVi } from "@/lib/format";
import { localTime, viDate } from "@/lib/time";
import { Badge, Empty } from "@/components/ui";

export type AttRow = {
  _id: unknown;
  workDate: string;
  checkInAt: Date;
  checkOutAt?: Date | null;
  totalHours?: number | null;
  roundedHours?: number | null;
  lateMinutes?: number | null;
  earlyMinutes?: number | null;
  shiftLabel?: string | null;
  outOfShift?: boolean | null;
  status: string;
  source?: string | null;
  createdByAdminName?: string | null;
  manualReason?: string | null;
  note?: string | null;
  checkInPhotoId?: string | null;
  checkOutPhotoId?: string | null;
  checkInPendingPhotoId?: unknown;
  checkOutPendingPhotoId?: unknown;
  /** "Hỗ trợ tại X" / "Hỗ trợ từ Y" – xem lib/support.labelSupport */
  supportLabel?: string;
};

/** Bảng chấm công theo mẫu: Ngày | Giờ Đến | Giờ Về | Tổng | Format | Giờ tính công | Ca | Cảnh báo | Ảnh | Ghi chú (spec 5) */
export function AttendanceTable({ rows, tz, actions }: { rows: AttRow[]; tz: string; actions?: (r: AttRow) => ReactNode }) {
  if (!rows.length) return <Empty>Chưa có dữ liệu chấm công</Empty>;
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl ring-1 ring-[#f1e6c8]">
      <table className="tbs">
        <thead>
          <tr>
            <th>Ngày</th>
            <th>Giờ Đến</th>
            <th>Giờ Về</th>
            <th className="text-right">Tổng</th>
            <th>Format</th>
            <th className="text-right">Giờ công</th>
            <th>Ca</th>
            <th>Cảnh báo</th>
            <th>Ảnh</th>
            <th>Ghi chú</th>
            {actions && <th></th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const id = String(r._id);
            const cls =
              r.status === "MISSING_CHECKOUT"
                ? "row-missing"
                : r.lateMinutes || r.earlyMinutes
                  ? "row-late"
                  : r.source === "ADMIN_MANUAL"
                    ? "row-manual"
                    : "";
            const hasIn = !!(r.checkInPhotoId || r.checkInPendingPhotoId);
            const hasOut = !!(r.checkOutPhotoId || r.checkOutPendingPhotoId);
            return (
              <tr key={id} className={cls}>
                <td className="whitespace-nowrap">{viDate(r.workDate)}</td>
                <td>{localTime(r.checkInAt, tz)}</td>
                <td>{r.checkOutAt ? localTime(r.checkOutAt, tz) : ""}</td>
                <td className="text-right">{hoursVi(r.totalHours)}</td>
                <td>{r.checkOutAt ? formatDuration(r.checkInAt, r.checkOutAt) : ""}</td>
                <td className="text-right font-bold">{hoursVi(r.roundedHours)}</td>
                <td className="whitespace-nowrap text-xs">{r.shiftLabel || (r.outOfShift ? <Badge>Ngoài ca</Badge> : "")}</td>
                <td className="space-x-1 whitespace-nowrap">
                  {!!r.lateMinutes && <Badge tone="orange">Muộn {r.lateMinutes}&apos;</Badge>}
                  {!!r.earlyMinutes && <Badge tone="orange">Sớm {r.earlyMinutes}&apos;</Badge>}
                  {r.status === "MISSING_CHECKOUT" && <Badge tone="red">Quên check-out</Badge>}
                  {r.status === "OPEN" && <Badge tone="yellow">Đang trong ca</Badge>}
                </td>
                <td className="whitespace-nowrap text-xs">
                  {hasIn && (
                    <a className="text-accent underline" href={`/api/photo?att=${id}&dir=in`} target="_blank">
                      in
                    </a>
                  )}{" "}
                  {hasOut && (
                    <a className="text-accent underline" href={`/api/photo?att=${id}&dir=out`} target="_blank">
                      out
                    </a>
                  )}
                </td>
                <td className="min-w-40 text-xs">
                  {r.supportLabel && <><Badge tone="blue">⇄ {r.supportLabel}</Badge>{" "}</>}
                  {r.source === "ADMIN_MANUAL" && (
                    <span>
                      <Badge tone="green">Chấm hộ</Badge> bởi {r.createdByAdminName}: {r.manualReason}
                    </span>
                  )}
                  {r.source === "REQUEST" && <Badge tone="pink">Theo yêu cầu điều chỉnh</Badge>} {r.note}
                </td>
                {actions && <td className="whitespace-nowrap">{actions(r)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function summarize(rows: AttRow[]) {
  const done = rows.filter((r) => r.status === "COMPLETED");
  return {
    totalRounded: Math.round(done.reduce((s, r) => s + (r.roundedHours || 0), 0) * 100) / 100,
    workDays: new Set(done.map((r) => r.workDate)).size,
    late: rows.filter((r) => (r.lateMinutes || 0) > 0).length,
    early: rows.filter((r) => (r.earlyMinutes || 0) > 0).length,
    missing: rows.filter((r) => r.status === "MISSING_CHECKOUT").length,
    manual: rows.filter((r) => r.source === "ADMIN_MANUAL").length,
  };
}
