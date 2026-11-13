import { requireActiveUser } from "@/lib/guards";
import { Device, Store } from "@/lib/models";
import { decrypt } from "@/lib/crypto";
import { vnd } from "@/lib/format";
import { viDateTime } from "@/lib/time";
import { Badge, Card, Field, Input } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { updateMyProfile } from "../actions";
import { SignOutButton } from "@/components/user/AuthButtons";
import ThemePicker from "@/components/user/ThemePicker";
import { isThemeId } from "@/lib/themes";

export default async function AccountPage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const devices = await Device.find({ userId: user._id }).sort({ lastSeenAt: -1 }).lean();
  const acc = decrypt(user.bankAccountEnc);
  return (
    <>
      <Card title="Màu giao diện">
        <ThemePicker current={isThemeId(user.theme) ? user.theme : "default"} locked={!!user.probation} />
      </Card>
      <Card title="Thông tin cá nhân">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink/60">Email</dt><dd className="break-all">{user.email}</dd>
          <dt className="text-ink/60">Cơ sở</dt><dd>{store?.name}</dd>
          {user.payType === "FULLTIME" ? (
            <><dt className="text-ink/60">Lương cứng</dt><dd>{vnd(user.monthlySalary)} / tháng</dd></>
          ) : (
            <><dt className="text-ink/60">Lương giờ</dt><dd>{vnd(user.hourlyWage)}</dd></>
          )}
        </dl>
        <ActionForm action={updateMyProfile} submitLabel="Lưu thông tin" successText="Đã lưu thông tin" className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Họ tên"><Input name="name" defaultValue={user.name} required minLength={2} maxLength={80} autoComplete="name" /></Field>
            <Field label="Số điện thoại"><Input name="phone" type="tel" inputMode="tel" defaultValue={user.phone} required autoComplete="tel" /></Field>
            <Field label="Ngân hàng"><Input name="bankName" defaultValue={user.bankName} maxLength={60} placeholder="VD Vietcombank" /></Field>
            <Field label="Số tài khoản"><Input name="bankAccount" inputMode="numeric" defaultValue={acc} maxLength={30} autoComplete="off" /></Field>
          </div>
        </ActionForm>
        <p className="mt-2 text-xs text-ink/60">Email, cơ sở và lương giờ do admin quản lý.</p>
      </Card>
      <Card title="Thiết bị">
        <ul className="space-y-2 text-sm">
          {devices.map((d) => (
            <li key={String(d._id)} className="flex items-center justify-between gap-2">
              <span>
                {d.model || d.os} · {d.browser}
                <span className="block text-xs text-ink/60">Lần cuối: {viDateTime(d.lastSeenAt)}</span>
              </span>
              <Badge tone={d.status === "APPROVED" ? "green" : d.status === "PENDING" ? "yellow" : "red"}>
                {d.status === "APPROVED" ? "Đã duyệt" : d.status === "PENDING" ? "Chờ duyệt" : "Thu hồi"}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
      <div className="text-center"><SignOutButton /></div>
    </>
  );
}
