import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/guards";
import { Device, LoginLog, Store, User, WageHistory } from "@/lib/models";
import { decrypt } from "@/lib/crypto";
import { vnd } from "@/lib/format";
import { localDate, viDate, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { DeviceActions } from "../../devices/DeviceActions";
import { resetFace, setWage, updateEmployee } from "../../../actions/people";

export const dynamic = "force-dynamic";

export default async function EmployeeDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const u = await User.findById(id).lean().catch(() => null);
  if (!u) notFound();
  const [stores, devices, wages, logs] = await Promise.all([
    Store.find().sort({ name: 1 }).lean(),
    Device.find({ userId: u._id }).sort({ lastSeenAt: -1 }).lean(),
    WageHistory.find({ userId: u._id }).sort({ effectiveFrom: -1 }).lean(),
    LoginLog.find({ userId: u._id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  const acc = decrypt(u.bankAccountEnc);
  return (
    <>
      <PageTitle sub={u.email}>
        <Link href="/admin/employees" className="text-sm font-normal underline">Nhân viên</Link> / {u.name}
      </PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Thông tin cơ bản">
          <div className="mb-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photo?face=${u._id}`} alt="" className="h-20 w-20 rounded-xl bg-cream object-cover" />
            <div className="text-xs text-ink/70">
              <p>Vào làm: {u.joinedAt ? viDateTime(u.joinedAt).slice(0, 10) : "—"}</p>
              <p>Đồng ý thu thập khuôn mặt: {u.consentFaceAt ? viDateTime(u.consentFaceAt) : "—"}</p>
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
          <div className="mt-4 border-t border-[#f1e6c8] pt-3">
            <ActionForm action={resetFace} submitLabel="Reset ảnh khuôn mặt" variant="outline" successText="Đã reset – nhân viên sẽ đăng ký lại" confirm="Nhân viên sẽ phải chụp lại ảnh mẫu và chờ duyệt lại. Tiếp tục?">
              <input type="hidden" name="userId" value={String(u._id)} />
            </ActionForm>
          </div>
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
      </div>
    </>
  );
}
