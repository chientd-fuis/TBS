import type { ReactNode } from "react";
import { formatDuration } from "@/lib/calc";
import { hoursVi } from "@/lib/format";
import { localTime, viDate } from "@/lib/time";
import { Badge, Empty } from "@/components/ui";
import AttEditButton from "@/components/user/AttEditButton";

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
  staffNote?: string | null;
  extraHours?: number | null;
  checkInPhotoId?: string | null;
  checkOutPhotoId?: string | null;
  checkInPendingPhotoId?: unknown;
  checkOutPendingPhotoId?: unknown;
  /** "Hỗ trợ tại X" / "Hỗ trợ từ Y" – xem lib/support.labelSupport */
  supportLabel?: string;
};

/** Bảng chấm công theo mẫu: Ngày | Giờ Đến | Giờ Về | Tổng | Format | Giờ tính công | Ca | Cảnh báo | Ảnh | Ghi chú (spec 5) */
export function AttendanceTable({
  rows,
  tz,
  actions,
  staffView = false,
  select,
  totals = false,
  staffEdit,
}: {
  rows: AttRow[];
  tz: string;
  actions?: (r: AttRow) => ReactNode;
  /** trang nhân viên: cột Ghi chú chỉ hiện ghi chú admin để lại */
  staffView?: boolean;
  /** cột tích chọn (xoá hàng loạt): ô thuộc form formId; header = ô "chọn tất cả" */
  select?: { formId: string; header?: ReactNode; disabled?: boolean };
  /** dòng tổng cuối bảng: tổng giờ thực tế · tổng giờ tính công · chênh */
  totals?: boolean;
  /** trang nhân viên: lượt bấm được để gửi yêu cầu sửa giờ (nhãn Quên check-out / Muộn / Sớm) · lượt đã gửi, chờ duyệt */
  staffEdit?: { editable: Set<string>; pending: Set<string> };
}) {
  if (!rows.length) return <Empty>Chưa có dữ liệu chấm công</Empty>;
  return (
    <div className="max-h-[70vh] overflow-auto rounded-xl ring-1 ring-[#f1e6c8]">
      <table className="tbs">
        <thead>
          <tr>
            {select && <th className="w-8 text-center">{select.header}</th>}
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
                {select && (
                  <td className="text-center">
                    <input type="checkbox" name="ids" value={id} form={select.formId} disabled={select.disabled} aria-label="Chọn lượt này" className="h-4 w-4 accent-[#c0392b]" />
                  </td>
                )}
                <td className="whitespace-nowrap">{viDate(r.workDate)}</td>
                <td>{localTime(r.checkInAt, tz)}</td>
                <td>{r.checkOutAt ? localTime(r.checkOutAt, tz) : ""}</td>
                <td className="text-right">{hoursVi(r.totalHours)}</td>
                <td>{r.checkOutAt ? formatDuration(r.checkInAt, r.checkOutAt) : ""}</td>
                <td className="text-right font-bold">
                  {hoursVi(r.roundedHours)}
                  {!!r.extraHours && <span className="block text-[10px] font-semibold text-secondary-dark" title="Admin cộng thêm cho ca này">gồm +{hoursVi(r.extraHours)}h</span>}
                </td>
                <td className="whitespace-nowrap text-xs">{r.shiftLabel || (r.outOfShift ? <Badge>Ngoài ca</Badge> : "")}</td>
                <td className="space-x-1 whitespace-nowrap">
                  {(() => {
                    const warn = !!r.lateMinutes || !!r.earlyMinutes || r.status === "MISSING_CHECKOUT";
                    const badges = (
                      <>
                        {!!r.lateMinutes && <Badge tone="orange">Muộn {r.lateMinutes}&apos;</Badge>}
                        {!!r.earlyMinutes && <Badge tone="orange">Sớm {r.earlyMinutes}&apos;</Badge>}
                        {r.status === "MISSING_CHECKOUT" && <Badge tone="red">Quên check-out</Badge>}
                      </>
                    );
                    // nhân viên: bấm nhãn cảnh báo → popup gửi yêu cầu sửa giờ đúng lượt này
                    if (staffEdit?.pending.has(id))
                      return (
                        <>
                          {badges} <Badge tone="yellow">Đã gửi sửa · chờ duyệt</Badge>
                        </>
                      );
                    if (warn && staffEdit?.editable.has(id)) return <AttEditButton id={id}>{badges}</AttEditButton>;
                    return badges;
                  })()}
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
                {staffView ? (
                  <td className="min-w-32 text-xs">{r.staffNote}</td>
                ) : (
                <td className="min-w-40 text-xs">
                  {r.supportLabel && <><Badge tone="blue">⇄ {r.supportLabel}</Badge>{" "}</>}
                  {r.source === "ADMIN_MANUAL" && (
                    <span>
                      <Badge tone="green">Chấm hộ</Badge> bởi {r.createdByAdminName}: {r.manualReason}
                    </span>
                  )}
                  {r.source === "REQUEST" && <Badge tone="pink">Theo yêu cầu điều chỉnh</Badge>} {r.note}
                  {r.staffNote && <div className="mt-0.5 text-secondary-dark">📝 Cho NV: {r.staffNote}</div>}
                </td>
                )}
                {actions && <td className="whitespace-nowrap">{actions(r)}</td>}
              </tr>
            );
          })}
        </tbody>
        {totals &&
          (() => {
            const s = summarize(rows);
            const diff = Math.round((s.totalRounded - s.totalActual) * 100) / 100;
            return (
              <tfoot>
                <tr className="bg-primary-light font-bold">
                  {select && <td></td>}
                  <td colSpan={3}>Tổng (lượt đã check-out)</td>
                  <td className="text-right" title="Tổng giờ thực tế">{hoursVi(s.totalActual)}</td>
                  <td></td>
                  <td className="text-right" title="Tổng giờ tính công">{hoursVi(s.totalRounded)}</td>
                  <td colSpan={4 + (actions ? 1 : 0)} className={`text-sm ${diff > 0 ? "text-secondary-dark" : diff < 0 ? "text-danger" : "text-ink/60"}`}>
                    Chênh (tính công − thực tế): {diff > 0 ? "+" : diff < 0 ? "−" : ""}
                    {hoursVi(Math.abs(diff))}h
                  </td>
                </tr>
              </tfoot>
            );
          })()}
      </table>
    </div>
  );
}

export function summarize(rows: AttRow[]) {
  const done = rows.filter((r) => r.status === "COMPLETED");
  return {
    totalRounded: Math.round(done.reduce((s, r) => s + (r.roundedHours || 0), 0) * 100) / 100,
    /** tổng giờ thực tế (giờ ra − giờ vào, chưa làm tròn) của lượt đã check-out */
    totalActual: Math.round(done.reduce((s, r) => s + (r.totalHours || 0), 0) * 100) / 100,
    workDays: new Set(done.map((r) => r.workDate)).size,
    late: rows.filter((r) => (r.lateMinutes || 0) > 0).length,
    early: rows.filter((r) => (r.earlyMinutes || 0) > 0).length,
    missing: rows.filter((r) => r.status === "MISSING_CHECKOUT").length,
    manual: rows.filter((r) => r.source === "ADMIN_MANUAL").length,
  };
}
