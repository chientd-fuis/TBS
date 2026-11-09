import { requireOwner } from "@/lib/guards";
import { AdminAccount, AdminLoginLog, AdminLoginSession } from "@/lib/models";
import { parseUA } from "@/lib/device";
import { ADMIN_PERMS } from "@/lib/permissions";
import { viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle } from "@/components/ui";
import { addAdminAccount, saveAdminAccount, setAdminStatus } from "../../actions/admins";

export const dynamic = "force-dynamic";

const ONLINE_MS = 5 * 60_000;
const ST = { PENDING: ["Chờ duyệt", "orange"], ACTIVE: ["Đang hoạt động", "green"], BLOCKED: ["Đã khoá", "red"] } as const;
const devName = (ua?: string | null) => {
  const u = parseUA(ua ?? "");
  return [u.model || u.os, u.browser].filter((x) => x && x !== "Khác").join(" · ") || "Không rõ";
};
type Dev = { deviceId: string; userAgent?: string | null; ip?: string | null; firstSeenAt?: Date | null; lastSeenAt?: Date | null };
const groups = [...new Set(ADMIN_PERMS.map((p) => p.group))];

function PermBoxes({ value = [] }: { value?: readonly string[] }) {
  return (
    <div className="rounded-xl bg-cream p-2.5">
      <p className="mb-1 text-xs font-semibold text-accent">Quyền (mặc định không có)</p>
      {groups.map((g) => (
        <div key={g} className="flex flex-wrap gap-x-4 gap-y-1 py-0.5 text-sm">
          {ADMIN_PERMS.filter((p) => p.group === g).map((p) => (
            <label key={p.key} className="flex items-center gap-1.5">
              <input type="checkbox" name="perms" value={p.key} defaultChecked={value.includes(p.key)} className="accent-[#3c9c54]" />
              {p.label}
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Admin Tổng: danh sách admin (đăng nhập Gmail) – thêm Gmail, duyệt yêu cầu, phân quyền, đổi tên, khoá, xoá, đăng xuất. */
export default async function AdminsPage() {
  await requireOwner();
  const list = await AdminAccount.find().sort({ status: 1, lastLoginAt: -1, createdAt: -1 }).lean();
  const now = Date.now();
  const [sessions, logs] = await Promise.all([
    AdminLoginSession.find({ accountId: { $in: list.map((a) => a._id) }, revokedAt: null, expiresAt: { $gt: new Date() } }).lean(),
    AdminLoginLog.find({ kind: "GOOGLE", displayName: { $in: list.map((a) => a.email) } }).sort({ createdAt: -1 }).limit(300).lean(),
  ]);
  const pending = list.filter((a) => a.status === "PENDING").length;

  return (
    <>
      <PageTitle sub="Admin đăng nhập bằng Gmail. Admin Tổng thêm Gmail ở đây, hoặc admin tự đăng nhập Gmail tại /admin/login rồi gửi yêu cầu để Admin Tổng duyệt. Mặc định admin KHÔNG có các quyền bên dưới – tick để cấp. Lãi lỗ, Doanh thu theo ngày và trang này chỉ Admin Tổng xem.">
        Quản lý admin
      </PageTitle>
      {pending > 0 && <Alert tone="orange">Có {pending} yêu cầu làm admin đang chờ duyệt.</Alert>}

      <Card title="➕ Thêm admin">
        <ActionForm action={addAdminAccount} submitLabel="Thêm admin" successText="Đã thêm – admin đăng nhập bằng Gmail này tại /admin/login" className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Gmail"><Input type="email" name="email" required placeholder="ten@gmail.com" /></Field>
            <Field label="Tên hiển thị" hint="Ghi vào lịch sử thao tác"><Input name="name" required placeholder="VD Lan – Văn Phú" /></Field>
          </div>
          <PermBoxes />
        </ActionForm>
      </Card>

      {!list.length && <Empty>Chưa có admin nào</Empty>}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((a) => {
          const id = String(a._id);
          const mine = sessions.filter((s) => String(s.accountId) === id);
          const online = mine.some((s) => now - (s.lastSeenAt ?? s.createdAt).getTime() < ONLINE_MS);
          const st = ST[a.status as keyof typeof ST];
          const myLogs = logs.filter((l) => l.displayName === a.email).slice(0, 5);
          const devs = a.devices as Dev[];
          return (
            <Card
              key={id}
              title={`${a.name} · ${a.email}`}
              actions={
                <span className="flex items-center gap-1.5">
                  {online && <span className="tbs-live-dot" title="Đang online" />}
                  <Badge tone={st[1]}>{st[0]}</Badge>
                </span>
              }
            >
              <p className="mb-2 text-xs text-ink/60">
                Lần vào gần nhất: {a.lastLoginAt ? viDateTime(a.lastLoginAt) : "chưa"}
                {a.lastIp && ` · IP ${a.lastIp}`}
                {a.lastUserAgent && ` · ${devName(a.lastUserAgent)}`} · {mine.length} phiên đang mở
                {a.approvedAt && ` · duyệt ${viDateTime(a.approvedAt)}`}
              </p>

              <ActionForm action={saveAdminAccount} submitLabel={a.status === "PENDING" ? "Duyệt & lưu quyền" : "Lưu"} successText="Đã lưu" className="space-y-2">
                <input type="hidden" name="id" value={id} />
                {a.status === "PENDING" && <input type="hidden" name="approve" value="1" />}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Tên hiển thị"><Input name="name" defaultValue={a.name} required /></Field>
                  <Field label="Ghi chú"><Input name="note" defaultValue={a.note ?? ""} placeholder="VD Quản lý CS1" /></Field>
                </div>
                <PermBoxes value={a.perms ?? []} />
              </ActionForm>

              {devs.length > 0 && (
                <details className="mt-3 border-t border-[#f1e6c8] pt-2 text-xs">
                  <summary className="cursor-pointer font-semibold text-accent">Thiết bị đã đăng nhập ({devs.length})</summary>
                  <ul className="mt-1 space-y-1">
                    {devs.map((d) => (
                      <li key={d.deviceId}>
                        <b>{devName(d.userAgent)}</b> {d.ip && `· IP ${d.ip}`}
                        <span className="block text-ink/60">
                          Lần đầu {d.firstSeenAt ? viDateTime(d.firstSeenAt) : "?"} · gần nhất {d.lastSeenAt ? viDateTime(d.lastSeenAt) : "?"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {myLogs.length > 0 && (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-accent">Lịch sử đăng nhập gần đây</summary>
                  <ul className="mt-1 space-y-0.5 text-ink/70">
                    {myLogs.map((l) => (
                      <li key={String(l._id)}>
                        {viDateTime(l.createdAt)} · {l.success ? "✓" : "✗ bị từ chối"} · IP {l.ip} · {devName(l.userAgent)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="mt-3 flex flex-wrap gap-2 border-t border-[#f1e6c8] pt-2">
                {mine.length > 0 && (
                  <ActionForm action={setAdminStatus} submitLabel="Đăng xuất" variant="outline" successText="Đã đăng xuất">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="op" value="logout" />
                  </ActionForm>
                )}
                {a.status !== "PENDING" && (
                  <ActionForm action={setAdminStatus} submitLabel={a.status === "BLOCKED" ? "Mở khoá" : "Khoá"} variant="outline" successText="" confirm={a.status === "BLOCKED" ? undefined : `Khoá ${a.name}? Admin bị đăng xuất và không vào được trang quản lý.`}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="op" value={a.status === "BLOCKED" ? "unblock" : "block"} />
                  </ActionForm>
                )}
                <ActionForm action={setAdminStatus} submitLabel={a.status === "PENDING" ? "Từ chối" : "Xoá"} variant="danger" successText="" confirm={`Xoá ${a.email} khỏi danh sách admin?`}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="op" value="delete" />
                </ActionForm>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
