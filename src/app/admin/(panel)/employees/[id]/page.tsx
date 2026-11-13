import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { Attendance, AttendanceArchive, Device, LoginLog, ProbationRequest, SalaryHistory, Store, User, WageHistory } from "@/lib/models";
import { seniorityStart, seniorityText } from "@/lib/seniority";
import { decrypt } from "@/lib/crypto";
import { vnd } from "@/lib/format";
import { localDate, localMonth, viDate, viDateTime, viMonth } from "@/lib/time";
import { PayTermsFields } from "@/components/PayTermsFields";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { DeviceActions } from "../../devices/DeviceActions";
import { probationAction, setPayTerms, setStaffPerms, setWage, updateEmployee } from "../../../actions/people";
import { OFFICIAL_WAGE, PROBATION_WAGE, probationConfig, probationEnd, probationShifts, TRIAL_SHIFTS } from "@/lib/probation";
import { STAFF_PERMS } from "@/lib/permissions";
import TransferAccount from "./TransferAccount";

export const dynamic = "force-dynamic";

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ transferred?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { transferred } = await searchParams;
  const u = await User.findById(id).lean().catch(() => null);
  if (!u) notFound();
  const [stores, devices, wages, logs, others, salaries] = await Promise.all([
    Store.find().sort({ name: 1 }).lean(),
    Device.find({ userId: u._id }).sort({ lastSeenAt: -1 }).lean(),
    WageHistory.find({ userId: u._id }).sort({ effectiveFrom: -1 }).lean(),
    LoginLog.find({ userId: u._id }).sort({ createdAt: -1 }).limit(20).lean(),
    // ứng viên Gmail mới: tài khoản mới đăng nhập / chờ duyệt lên đầu
    User.find({ _id: { $ne: u._id } }).select("email name googleName status createdAt").sort({ createdAt: -1 }).limit(300).lean(),
    SalaryHistory.find({ userId: u._id }).sort({ effectiveMonth: -1, createdAt: -1 }).lean(),
  ]);
  // thâm niên: ngày bắt đầu sớm nhất (vào làm / ngày đi làm đầu tiên đã lưu / chấm công sớm nhất còn lại)
  const [firstAtt, archived, liveDays] = await Promise.all([
    Attendance.findOne({ userId: u._id }).sort({ workDate: 1 }).select("workDate").lean(),
    AttendanceArchive.aggregate<{ days: number; hours: number }>([{ $match: { userId: u._id } }, { $group: { _id: null, days: { $sum: "$days" }, hours: { $sum: "$hours" } } }]),
    Attendance.distinct("workDate", { userId: u._id }),
  ]);
  const startDay = seniorityStart([u.joinedAt ? localDate(new Date(u.joinedAt)) : null, u.firstWorkDate, firstAtt?.workDate]);
  const workDays = (archived[0]?.days ?? 0) + liveDays.length;
  const fulltime = u.payType === "FULLTIME";
  const probShifts = u.probation && u.probationStart ? await probationShifts(u._id, u.probationStart) : 0;
  // 3 ca thử việc / yêu cầu hết tháng thử việc đang chờ
  const [trialDone, pendingMonth, probCfg] = u.probation
    ? await Promise.all([
        u.trialStage === "ON" && u.probationStart ? Attendance.countDocuments({ userId: u._id, status: "COMPLETED", workDate: { $gte: u.probationStart } }) : 0,
        ProbationRequest.exists({ userId: u._id, kind: "MONTH", status: "PENDING" }),
        probationConfig(),
      ])
    : [0, null, { monthOn: true, trialHalf: true }];
  const rank = (st: string) => (st === "NEW" ? 0 : st === "PENDING" ? 1 : st === "REJECTED" ? 2 : 3);
  const candidates = others
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((o) => ({ id: String(o._id), email: o.email, name: o.name || o.googleName || "", status: o.status }));
  const acc = decrypt(u.bankAccountEnc);
  return (
    <>
      <PageTitle sub={u.noLogin ? "Không có tài khoản đăng nhập (admin tạo để nhập chấm công / tính lương)" : u.email}>
        <Link href="/admin/employees" className="text-sm font-normal underline">Nhân viên</Link> / {u.name}
      </PageTitle>
      {transferred && <Alert tone="green">Đã chuyển toàn bộ dữ liệu từ tài khoản Gmail cũ sang {u.email} và xoá tài khoản cũ.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Thông tin cơ bản">
          <div className="mb-3 flex items-center gap-3">
            {u.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u.avatar} alt="" className="h-16 w-16 rounded-full bg-cream object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cream text-2xl font-bold">{u.name?.[0] ?? "?"}</div>
            )}
            <div className="text-xs text-ink/70">
              <p>Vào làm: {u.joinedAt ? viDateTime(u.joinedAt).slice(0, 10) : "—"}</p>
              {startDay && (
                <p>
                  Thâm niên: <b>{seniorityText(startDay, localDate(new Date()))}</b> (từ {viDate(startDay)}) · {workDays} ngày công
                </p>
              )}
              <p>Đồng ý điều khoản chấm công: {u.consentFaceAt ? viDateTime(u.consentFaceAt) : "—"}</p>
            </div>
          </div>
          <ActionForm action={updateEmployee}>
            <input type="hidden" name="userId" value={String(u._id)} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Họ tên"><Input name="name" defaultValue={u.name} /></Field>
              <Field label="SĐT"><Input name="phone" defaultValue={u.phone} /></Field>
              <Field label="Ngân hàng"><Input name="bankName" defaultValue={u.bankName} /></Field>
              <Field label="Số tài khoản" hint="Để nguyên nếu không đổi"><Input name="bankAccount" defaultValue={acc} /></Field>
              <Field label="Cơ sở">
                <Select name="storeId" defaultValue={String(u.storeId || "")}>
                  {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
                </Select>
              </Field>
              <Field label="Trạng thái">
                <Select name="status" defaultValue={u.status}>
                  <option value="ACTIVE">Đang làm</option>
                  <option value="INACTIVE">Nghỉ việc</option>
                  {!["ACTIVE", "INACTIVE"].includes(u.status) && <option value={u.status}>{u.status}</option>}
                </Select>
              </Field>
            </div>
          </ActionForm>
        </Card>
        <Card
          title={u.probation ? (u.probationReview ? "🟣 Thử việc · cần xem xét" : "🟣 Đang thử việc") : "Thử việc"}
          className={u.probation ? "ring-2 ring-violet-line" : undefined}
        >
          {u.probation && u.probationStart ? (
            <div className="space-y-3 text-sm">
              <p>
                Bắt đầu <b>{viDate(u.probationStart)}</b> · hết tháng thử việc <b>{viDate(probationEnd(u.probationStart))}</b> · đã làm <b>{probShifts} ca</b>. Lương hiện tại{" "}
                {vnd(u.hourlyWage)}/giờ.
              </p>
              {u.trialStage === "ON" && (
                <Alert tone="pink">
                  Đang làm <b>3 ca thử việc</b>: xong {trialDone}/{TRIAL_SHIFTS} ca{probCfg.trialHalf ? " (tính 50% giờ công)" : ""}. Xong ca thứ 3 → gửi admin Nhận / Không nhận.
                </Alert>
              )}
              {u.trialStage === "PENDING" && (
                <Alert tone="orange">
                  Đã xong 3 ca thử việc – <b>chờ admin Nhận / Không nhận</b> ở{" "}
                  <Link href="/admin/requests" className="font-semibold underline">
                    Yêu cầu
                  </Link>
                  .
                </Alert>
              )}
              {pendingMonth && (
                <Alert tone="orange">
                  Hết tháng thử việc – <b>chờ admin xác nhận lên lương {vnd(OFFICIAL_WAGE)}/giờ</b> ở{" "}
                  <Link href="/admin/requests" className="font-semibold underline">
                    Yêu cầu
                  </Link>
                  .
                </Alert>
              )}
              <p className="text-xs text-ink/60">
                {probCfg.monthOn
                  ? `Hết tháng thử việc → hỏi admin áp dụng lương ${vnd(OFFICIAL_WAGE)}/giờ (Đồng ý / Chưa – gia hạn 1 tháng).`
                  : `Không có tháng thử việc: được nhận sau 3 ca là lên chính thức ${vnd(OFFICIAL_WAGE)}/giờ.`}{" "}
                Đang thử việc: không dùng Chốt ca / Nhận hàng / Tồn kho, app màu hồng tím.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <ActionForm action={probationAction} submitLabel="Chuyển chính thức" variant="secondary" successText="Đã chuyển chính thức" className="flex items-end gap-2">
                  <input type="hidden" name="userId" value={String(u._id)} />
                  <input type="hidden" name="op" value="official" />
                  <Field label="Lương giờ chính thức">
                    <Input name="hourlyWage" inputMode="numeric" placeholder={String(Math.max(OFFICIAL_WAGE, u.hourlyWage || 0))} className="w-32" />
                  </Field>
                </ActionForm>
                <ActionForm action={probationAction} submitLabel="Gia hạn thử việc 1 tháng" variant="outline" successText="Đã gia hạn" confirm={`Gia hạn thử việc cho ${u.name} thêm 1 tháng từ hôm nay?`}>
                  <input type="hidden" name="userId" value={String(u._id)} />
                  <input type="hidden" name="op" value="extend" />
                </ActionForm>
                <ActionForm action={probationAction} submitLabel="Bỏ thử việc (giữ lương)" variant="ghost" successText="Đã bỏ thử việc" confirm={`Bỏ thử việc cho ${u.name}, giữ nguyên lương ${vnd(u.hourlyWage)}/giờ?`}>
                  <input type="hidden" name="userId" value={String(u._id)} />
                  <input type="hidden" name="op" value="stop" />
                </ActionForm>
              </div>
            </div>
          ) : (
            <ActionForm action={probationAction} submitLabel="Đặt thử việc từ hôm nay" variant="outline" successText="Đã đặt thử việc" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="userId" value={String(u._id)} />
              <input type="hidden" name="op" value="start" />
              <Field label="Lương giờ thử việc" hint={`Trống = ${vnd(PROBATION_WAGE)}`}>
                <Input name="hourlyWage" inputMode="numeric" placeholder={String(PROBATION_WAGE)} className="w-32" />
              </Field>
            </ActionForm>
          )}
        </Card>
        <Card title={fulltime ? `Full-time · lương cứng ${vnd(u.monthlySalary)} / tháng · nghỉ có lương ${u.paidLeaveDays || 0} ngày` : "Hình thức lương: Part-time (lương giờ)"}>
          <p className="mb-2 text-xs text-ink/70">
            Full-time: lương cơ bản trong bảng lương = lương cứng / tháng (giờ chấm công vẫn được đếm để theo dõi, không nhân lương giờ, không nhân hệ số ngày lễ).
            Đổi hình thức / mức lương cứng áp dụng cho cả tháng chọn trở đi.
          </p>
          <ActionForm action={setPayTerms} submitLabel="Cập nhật hình thức lương" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={String(u._id)} />
            <PayTermsFields defaultType={fulltime ? "FULLTIME" : "HOURLY"} defaultSalary={u.monthlySalary || 0} defaultLeave={u.paidLeaveDays || 0} hourly={false} month={localMonth(new Date())} />
          </ActionForm>
          {salaries.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {salaries.map((h) => (
                <li key={String(h._id)}>
                  Từ tháng {viMonth(h.effectiveMonth)}: <b>{h.payType === "FULLTIME" ? `Full-time · ${vnd(h.monthlySalary ?? 0)} / tháng · nghỉ có lương ${h.paidLeaveDays ?? 0} ngày` : "Part-time (lương giờ)"}</b>{" "}
                  <span className="text-xs text-ink/60">({h.createdBy})</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Lương giờ hiện tại: ${vnd(u.hourlyWage)}${fulltime ? " (không dùng khi Full-time)" : ""}`}>
          <ActionForm action={setWage} submitLabel="Cập nhật lương" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="userId" value={String(u._id)} />
            <Field label="Lương giờ mới (VND)"><Input name="hourlyWage" inputMode="numeric" required /></Field>
            <Field label="Hiệu lực từ ngày"><Input type="date" name="effectiveFrom" defaultValue={localDate(new Date())} /></Field>
          </ActionForm>
          <ul className="mt-3 space-y-1 text-sm">
            {wages.map((w) => (
              <li key={String(w._id)}>Từ {viDate(w.effectiveFrom)}: <b>{vnd(w.hourlyWage)}</b> <span className="text-xs text-ink/60">({w.createdBy})</span></li>
            ))}
          </ul>
        </Card>
        <Card title="Thiết bị">
          <ul className="space-y-3 text-sm">
            {devices.map((d) => (
              <li key={String(d._id)} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {d.model || d.os} · {d.browser}{" "}
                  <Badge tone={d.status === "APPROVED" ? "green" : d.status === "PENDING" ? "yellow" : "red"}>{d.status}</Badge>
                  <span className="block text-xs text-ink/60">Lần đầu {viDateTime(d.firstSeenAt)} · gần nhất {viDateTime(d.lastSeenAt)}</span>
                </span>
                <DeviceActions id={String(d._id)} status={d.status} stack={false} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Lịch sử đăng nhập">
          <ul className="space-y-1 text-xs">
            {logs.map((l) => (
              <li key={String(l._id)}>{viDateTime(l.createdAt)} · IP {l.ip} · {l.deviceId?.slice(0, 8)}…</li>
            ))}
          </ul>
        </Card>
        <Card title="Quyền quản lý (nhân viên)">
          <ActionForm action={setStaffPerms} submitLabel="Lưu quyền" successText="Đã lưu" className="space-y-3 text-sm">
            <input type="hidden" name="userId" value={String(u._id)} />
            <p className="text-xs text-ink/70">
              Nhân viên được cấp quyền sẽ thấy nút <b>Quản lý</b> trong app. Mọi thao tác của họ được ghi lại ở <b>Tổng quan</b> của cơ sở đó.
            </p>
            <div className="space-y-1.5">
              {STAFF_PERMS.map((p) => (
                <label key={p.key} className="flex items-start gap-2">
                  <input type="checkbox" name="managerPerms" value={p.key} defaultChecked={u.managerPerms?.includes(p.key)} className="mt-0.5 accent-secondary" />
                  <span>
                    <b>{p.label}</b> <span className="text-xs text-ink/60">– {p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-accent">Cơ sở được quản lý</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {stores.map((s) => {
                  const home = String(s._id) === String(u.storeId);
                  return (
                    <label key={String(s._id)} className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        name="managerStoreIds"
                        value={String(s._id)}
                        defaultChecked={home || (u.managerStoreIds ?? []).map(String).includes(String(s._id))}
                        disabled={home}
                        className="accent-secondary"
                      />
                      {s.name}
                      {home && <span className="text-xs text-ink/50">(cơ sở gốc)</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          </ActionForm>
        </Card>
        <Card title="Chuyển sang tài khoản Gmail mới">
          <TransferAccount fromId={String(u._id)} fromEmail={u.email} fromName={u.name || u.googleName || u.email} candidates={candidates} />
        </Card>
      </div>
    </>
  );
}
