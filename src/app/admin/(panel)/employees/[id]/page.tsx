import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { Device, LoginLog, Store, User, WageHistory } from "@/lib/models";
import { decrypt } from "@/lib/crypto";
import { vnd } from "@/lib/format";
import { localDate, viDate, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { DeviceActions } from "../../devices/DeviceActions";
import { setStaffPerms, setWage, updateEmployee } from "../../../actions/people";
import { STAFF_PERMS } from "@/lib/permissions";
import TransferAccount from "./TransferAccount";

export const dynamic = "force-dynamic";

export default async function EmployeeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ transferred?: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const { transferred } = await searchParams;
  const u = await User.findById(id).lean().catch(() => null);
  if (!u) notFound();
  const [stores, devices, wages, logs, others] = await Promise.all([
    Store.find().sort({ name: 1 }).lean(),
    Device.find({ userId: u._id }).sort({ lastSeenAt: -1 }).lean(),
    WageHistory.find({ userId: u._id }).sort({ effectiveFrom: -1 }).lean(),
    LoginLog.find({ userId: u._id }).sort({ createdAt: -1 }).limit(20).lean(),
    // ứng viên Gmail mới: tài khoản mới đăng nhập / chờ duyệt lên đầu
    User.find({ _id: { $ne: u._id } }).select("email name googleName status createdAt").sort({ createdAt: -1 }).limit(300).lean(),
  ]);
  const rank = (st: string) => (st === "NEW" ? 0 : st === "PENDING" ? 1 : st === "REJECTED" ? 2 : 3);
  const candidates = others
    .sort((a, b) => rank(a.status) - rank(b.status))
    .map((o) => ({ id: String(o._id), email: o.email, name: o.name || o.googleName || "", status: o.status }));
  const acc = decrypt(u.bankAccountEnc);
  return (
    <>
      <PageTitle sub={u.email}>
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
        <Card title={`Lương giờ hiện tại: ${vnd(u.hourlyWage)}`}>
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
                <DeviceActions id={String(d._id)} status={d.status} />
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
                  <input type="checkbox" name="managerPerms" value={p.key} defaultChecked={u.managerPerms?.includes(p.key)} className="mt-0.5 accent-[#3c9c54]" />
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
                        className="accent-[#3c9c54]"
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
