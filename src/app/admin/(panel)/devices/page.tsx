import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { Device, LoginLog, User } from "@/lib/models";
import { viDateTime } from "@/lib/time";
import { Badge, Card, Empty, PageTitle } from "@/components/ui";
import { DeviceActions } from "./DeviceActions";

export const dynamic = "force-dynamic";

/** Thiết bị chờ duyệt + cảnh báo nghi chấm hộ (spec 3.3, 4.1.1) */
export default async function DevicesPage() {
  await requireAdmin();
  const activeIds = await User.find({ status: "ACTIVE" }).distinct("_id");
  const pending = await Device.find({ status: "PENDING", userId: { $in: activeIds } }).sort({ requestedAt: -1, firstSeenAt: -1 }).lean();
  const users = new Map((await User.find().select("name email").lean()).map((u) => [String(u._id), u]));

  // Cảnh báo 1: cùng fingerprint xuất hiện ở nhiều tài khoản
  const shared = await Device.aggregate<{ _id: string; users: string[]; n: number }>([
    { $match: { fingerprintHash: { $nin: [null, ""] } } },
    { $group: { _id: "$fingerprintHash", users: { $addToSet: "$userId" }, n: { $sum: 1 } } },
    { $match: { "users.1": { $exists: true } } },
  ]);
  // Cảnh báo 2: một thiết bị bị nhiều tài khoản khác nhau đăng nhập (30 ngày)
  const since = new Date(Date.now() - 30 * 86400_000);
  const multiLogin = await LoginLog.aggregate<{ _id: string; users: string[] }>([
    { $match: { createdAt: { $gte: since }, deviceId: { $nin: [null, ""] } } },
    { $group: { _id: "$deviceId", users: { $addToSet: "$userId" } } },
    { $match: { "users.1": { $exists: true } } },
  ]);
  const owners = new Map((await Device.find({ deviceId: { $in: multiLogin.map((m) => m._id) } }).lean()).map((d) => [d.deviceId, String(d.userId)]));

  const uname = (id: unknown) => users.get(String(id))?.name || users.get(String(id))?.email || "?";
  return (
    <>
      <PageTitle sub="Nhân viên chỉ chấm công được trên thiết bị đã duyệt; 1 thiết bị chỉ thuộc 1 nhân viên">Thiết bị</PageTitle>
      <Card title={`Yêu cầu đổi thiết bị (${pending.length})`}>
        {pending.length === 0 ? (
          <Empty>Không có yêu cầu</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Nhân viên</th><th>Thiết bị</th><th>Lần đầu thấy</th><th>Ghi chú</th><th></th></tr></thead>
              <tbody>
                {pending.map((d) => (
                  <tr key={String(d._id)}>
                    <td><Link className="underline" href={`/admin/employees/${d.userId}`}>{uname(d.userId)}</Link></td>
                    <td>{d.model || d.os} · {d.browser}<div className="max-w-64 truncate text-xs text-ink/50">{d.userAgent}</div></td>
                    <td className="text-xs">{viDateTime(d.firstSeenAt)}</td>
                    <td className="space-y-1 text-xs">
                      {d.requestedAt && <Badge tone="yellow">NV đã gửi yêu cầu {viDateTime(d.requestedAt)}</Badge>}
                      {d.possibleOldDeviceId && <Badge tone="green">Có thể là thiết bị cũ (trùng fingerprint)</Badge>}
                    </td>
                    <td><DeviceActions id={String(d._id)} status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="⚠️ Cảnh báo nghi chấm hộ">
        {shared.length === 0 && multiLogin.length === 0 ? (
          <Empty>Không phát hiện bất thường</Empty>
        ) : (
          <ul className="space-y-2 text-sm">
            {shared.map((s) => (
              <li key={s._id}>
                <Badge tone="orange">Trùng đặc điểm máy</Badge> {s.users.length} tài khoản có cùng đặc điểm trình duyệt (cùng máy, hoặc chỉ cùng dòng máy & phiên bản): {s.users.map(uname).join(", ")}
              </li>
            ))}
            {multiLogin.map((m) => (
              <li key={m._id}>
                <Badge tone="red">Đăng nhập chéo</Badge> Thiết bị của <b>{uname(owners.get(m._id))}</b> đã được đăng nhập bởi: {m.users.map(uname).join(", ")}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
