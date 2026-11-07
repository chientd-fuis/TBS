import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { Attendance, Store, User } from "@/lib/models";
import { localDate, localMonth, localTime, viDate } from "@/lib/time";
import { hoursVi } from "@/lib/format";
import { isMonthLocked, payStoreFilter } from "@/lib/attendance";
import { labelSupport } from "@/lib/support";
import { AttendanceTable, summarize, type AttRow } from "@/components/AttendanceTable";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Empty, Field, Input, LinkButton, PageTitle, Select, Textarea } from "@/components/ui";
import { manualAttendance } from "../../actions/ops";
import QuickEdit from "./QuickEdit";
import MonthShiftBoard from "./MonthShiftBoard";
import { loadMonthBoard } from "./month-board-data";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import TimeInput from "@/components/TimeInput";

export const dynamic = "force-dynamic";

/** Bảng chấm công (spec 5) + chấm hộ (3.5) */
export default async function AttendanceAdmin({ searchParams }: { searchParams: Promise<{ store?: string; user?: string; month?: string; status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find().sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : localMonth(new Date(), tz);
  const staff = await User.find({ storeId: store?._id, status: { $in: ["ACTIVE", "INACTIVE"] } }).sort({ status: 1, name: 1 }).lean();
  const selected = staff.find((u) => String(u._id) === sp.user);
  const locked = store ? await isMonthLocked(store._id, month) : false;
  const params = { store: String(store?._id), user: sp.user, status: sp.status };

  // bảng chấm công theo cơ sở GỐC (khớp bảng lương): gồm cả giờ nhân viên đi hỗ trợ nơi khác
  const q: Record<string, unknown> = { month, ...(store ? payStoreFilter(store._id) : {}) };
  if (selected) q.userId = selected._id;
  if (sp.status) q.status = sp.status;
  const rows = await labelSupport(await Attendance.find(q).sort({ checkInAt: 1 }).lean(), String(store?._id));
  const name = new Map(staff.map((u) => [String(u._id), u.name]));
  // nhân viên cơ sở khác sang hỗ trợ tại cơ sở này (lương tính ở cơ sở gốc của họ)
  const visitors = store
    ? await labelSupport(
        await Attendance.find({ storeId: store._id, month, homeStoreId: { $exists: true, $ne: store._id } }).sort({ checkInAt: 1 }).lean(),
        String(store._id),
      )
    : [];
  // ===== Bảng chấm công theo ca cả tháng (giống bảng xếp ca – chế độ xem) =====
  const board = store ? await loadMonthBoard(String(store._id), month, tz, stores) : null;
  const visitorNames = new Map(
    (await User.find({ _id: { $in: visitors.map((v) => v.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name]),
  );

  return (
    <>
      <PageTitle sub="Tô màu: cam = muộn/sớm · đỏ = quên check-out · xanh = chấm hộ">Bảng chấm công</PageTitle>
      <Card>
        <AutoFilterForm key={`${store?._id}|${sp.user}|${month}|${sp.status}`} className="flex flex-wrap items-end gap-2" resetOnChange={{ store: ["user"] }}>
          <Field label="Cơ sở">
            <Select name="store" defaultValue={String(store?._id)} className="w-44">
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Nhân viên">
            <Select name="user" defaultValue={sp.user || ""} className="w-48">
              <option value="">— Tổng hợp tất cả —</option>
              {staff.map((u) => <option key={String(u._id)} value={String(u._id)}>{u.name}{u.status === "INACTIVE" ? " (nghỉ)" : ""}</option>)}
            </Select>
          </Field>
          <Field label="Tháng"><Input type="month" name="month" defaultValue={month} className="w-40" /></Field>
          <Field label="Trạng thái">
            <Select name="status" defaultValue={sp.status || ""} className="w-40">
              <option value="">Tất cả</option>
              <option value="OPEN">Đang trong ca</option>
              <option value="MISSING_CHECKOUT">Quên check-out</option>
              <option value="COMPLETED">Hoàn thành</option>
            </Select>
          </Field>
          <div className="ml-auto"><MonthPicker month={month} base="/admin/attendance" params={params} /></div>
        </AutoFilterForm>
      </Card>
      {locked && <Alert tone="yellow">🔒 Tháng này đã chốt bảng lương – không thể sửa / chấm hộ. Mở khoá tại mục Bảng lương nếu cần.</Alert>}

      {selected || sp.status ? (
        <Card
          title={selected ? `${selected.name} – tháng ${month.slice(5)}/${month.slice(0, 4)}` : `Danh sách lọc (${rows.length})`}
          actions={
            selected && (
              <LinkButton variant="outline" href={`/api/admin/export?type=chamcong&store=${store?._id}&user=${selected._id}&from=${month}&to=${month}`}>
                Xuất Excel
              </LinkButton>
            )
          }
        >
          {selected && <SummaryLine rows={rows} />}
          <AttendanceTable
            rows={rows as AttRow[]}
            tz={tz}
            actions={(r) => (
              <div className="flex flex-col gap-1 text-xs">
                {!selected && <span className="font-semibold">{name.get(String((r as AttRow & { userId: unknown }).userId))}</span>}
                {!locked && (
                  <QuickEdit
                    id={String(r._id)}
                    date={r.workDate}
                    inTime={localTime(r.checkInAt, tz)}
                    outTime={r.checkOutAt ? localTime(r.checkOutAt, tz) : ""}
                    missingOut={r.status === "MISSING_CHECKOUT"}
                  />
                )}
                <Link className="text-accent underline" href={`/admin/attendance/${r._id}`}>Chi tiết / lịch sử</Link>
                {(!!r.lateMinutes || !!r.earlyMinutes || r.status === "MISSING_CHECKOUT") && (
                  <Link
                    className="text-danger underline"
                    href={`/admin/bonus-penalty?store=${store?._id}&user=${(r as AttRow & { userId: unknown }).userId}&date=${r.workDate}&att=${r._id}&content=${encodeURIComponent(
                      r.status === "MISSING_CHECKOUT" ? `Quên check-out ngày ${viDate(r.workDate)}` : r.lateMinutes ? `Đi muộn ${r.lateMinutes} phút ngày ${viDate(r.workDate)}` : `Về sớm ${r.earlyMinutes} phút ngày ${viDate(r.workDate)}`,
                    )}#form`}
                  >
                    Thêm phạt
                  </Link>
                )}
              </div>
            )}
          />
        </Card>
      ) : (
        <>
          {board && (
            <Card title={`Chấm công theo ca – tháng ${month.slice(5)}/${month.slice(0, 4)}`}>
              {board.templates.length ? (
                <MonthShiftBoard month={month} today={localDate(new Date(), tz)} {...board} />
              ) : (
                <p className="text-sm text-ink/60">Cơ sở chưa có ca làm việc.</p>
              )}
            </Card>
          )}
          <Card title="Tổng hợp tháng">
            <SummaryTable rows={rows} staff={staff.map((u) => ({ id: String(u._id), name: u.name, inactive: u.status === "INACTIVE" }))} storeId={String(store?._id)} month={month} />
            {rows.some((r) => r.supportLabel) && <p className="mt-2 text-xs text-ink/60">Đã gồm giờ nhân viên đi hỗ trợ cơ sở khác (lương do {store?.name} trả).</p>}
          </Card>
          {visitors.length > 0 && (
            <Card title={`Nhân viên cơ sở khác hỗ trợ tại ${store?.name} (${visitors.length} lượt)`}>
              <p className="mb-2 text-xs text-ink/60">Chỉ để theo dõi – giờ công và lương tính ở bảng của cơ sở gốc.</p>
              <AttendanceTable
                rows={visitors as AttRow[]}
                tz={tz}
                actions={(r) => <span className="text-xs font-semibold">{visitorNames.get(String((r as AttRow & { userId: unknown }).userId))}</span>}
              />
            </Card>
          )}
        </>
      )}

      {!locked && (
        <Card title="Chấm công hộ">
          <ActionForm action={manualAttendance} submitLabel="Ghi nhận chấm hộ" successText="Đã chấm hộ">
            <p className="text-xs text-ink/70">Dùng khi nhân viên không chấm được (hỏng điện thoại, hết pin, lỗi camera/GPS…). Không cần nhân viên xác nhận. Bản ghi có nhãn &quot;Chấm hộ&quot;.</p>
            <div className="grid gap-3 sm:grid-cols-5">
              <Field label="Nhân viên">
                <Select name="userId" defaultValue={sp.user || ""} required>
                  <option value="">— Chọn —</option>
                  {staff.filter((u) => u.status === "ACTIVE").map((u) => <option key={String(u._id)} value={String(u._id)}>{u.name}</option>)}
                </Select>
              </Field>
              <Field label="Ngày"><Input type="date" name="date" defaultValue={localDate(new Date(), tz)} required /></Field>
              <Field label="Giờ vào"><TimeInput seconds name="inTime" required /></Field>
              <Field label="Giờ ra" hint="Bỏ trống nếu chỉ check-in"><TimeInput seconds name="outTime" /></Field>
              <Field label="Làm tại" hint="Đi hỗ trợ thì chọn cơ sở đó">
                <Select name="workStoreId" defaultValue="">
                  <option value="">Tự nhận (theo ca / cơ sở gốc)</option>
                  {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
                </Select>
              </Field>
            </div>
            <Field label="Lý do (bắt buộc)"><Textarea name="reason" rows={2} required /></Field>
          </ActionForm>
        </Card>
      )}
    </>
  );
}

function SummaryLine({ rows }: { rows: { status: string; roundedHours?: number | null; workDate: string; lateMinutes?: number | null; earlyMinutes?: number | null; source?: string | null }[] }) {
  const s = summarize(rows as AttRow[]);
  return (
    <div className="mb-3 flex flex-wrap gap-2 text-sm">
      <Badge tone="yellow">Giờ công: {hoursVi(s.totalRounded)}</Badge>
      <Badge tone="yellow">Ngày công: {s.workDays}</Badge>
      <Badge tone="orange">Muộn: {s.late}</Badge>
      <Badge tone="orange">Sớm: {s.early}</Badge>
      <Badge tone="red">Quên check-out: {s.missing}</Badge>
      <Badge tone="green">Chấm hộ: {s.manual}</Badge>
    </div>
  );
}

function SummaryTable({ rows, staff, storeId, month }: { rows: (AttRow & { userId?: unknown })[]; staff: { id: string; name: string; inactive: boolean }[]; storeId: string; month: string }) {
  if (!staff.length) return <Empty>Chưa có nhân viên</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbs">
        <thead>
          <tr><th>Nhân viên</th><th className="text-center">Giờ tính công</th><th className="text-center">Ngày công</th><th className="text-center">Muộn</th><th className="text-center">Sớm</th><th className="text-center">Quên check-out</th><th className="text-center">Chấm hộ</th><th></th></tr>
        </thead>
        <tbody>
          {staff.map((u) => {
            const s = summarize(rows.filter((r) => String(r.userId) === u.id));
            return (
              <tr key={u.id} className={s.missing ? "row-missing" : ""}>
                <td className="font-semibold">{u.name}{u.inactive && <span className="text-xs text-ink/50"> (nghỉ)</span>}</td>
                <td className="text-center font-bold">{hoursVi(s.totalRounded)}</td>
                <td className="text-center">{s.workDays}</td>
                <td className="text-center text-warn">{s.late || ""}</td>
                <td className="text-center text-warn">{s.early || ""}</td>
                <td className="text-center text-danger">{s.missing || ""}</td>
                <td className="text-center">{s.manual || ""}</td>
                <td><Link className="text-accent underline" href={`/admin/attendance?store=${storeId}&user=${u.id}&month=${month}`}>Chi tiết</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
