import { requireActiveUser } from "@/lib/guards";
import { Device, Store } from "@/lib/models";
import { decrypt } from "@/lib/crypto";
import { vnd } from "@/lib/format";
import { viDateTime } from "@/lib/time";
import { Badge, Card } from "@/components/ui";
import { SignOutButton } from "@/components/user/AuthButtons";

export default async function AccountPage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const devices = await Device.find({ userId: user._id }).sort({ lastSeenAt: -1 }).lean();
  const acc = decrypt(user.bankAccountEnc);
  return (
    <>
      <Card title="Thông tin cá nhân">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink/60">Họ tên</dt><dd>{user.name}</dd>
          <dt className="text-ink/60">Email</dt><dd className="break-all">{user.email}</dd>
          <dt className="text-ink/60">SĐT</dt><dd>{user.phone}</dd>
          <dt className="text-ink/60">Cơ sở</dt><dd>{store?.name}</dd>
          <dt className="text-ink/60">Ngân hàng</dt><dd>{user.bankName} {acc && `· ****${acc.slice(-4)}`}</dd>
          <dt className="text-ink/60">Lương giờ</dt><dd>{vnd(user.hourlyWage)}</dd>
        </dl>
        <p className="mt-3 text-xs text-ink/60">Cần sửa thông tin? Liên hệ admin cơ sở.</p>
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
