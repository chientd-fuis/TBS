import { requireAdmin } from "@/lib/guards";
import { Device, Store, User } from "@/lib/models";
import { viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Input, PageTitle } from "@/components/ui";
import { approveUser, rejectUser } from "../../actions/people";
import { OFFICIAL_WAGE, PROBATION_WAGE, probationConfig, TRIAL_SHIFTS } from "@/lib/probation";

const vnd = (n: number) => n.toLocaleString("vi-VN");

export const dynamic = "force-dynamic";

/** Duyệt đăng ký nhân viên (spec 3.1) */
export default async function ApprovalsPage() {
  await requireAdmin();
  const users = await User.find({ status: "PENDING" }).sort({ registeredAt: 1 }).lean();
  const probCfg = await probationConfig();
  const stores = new Map((await Store.find().lean()).map((s) => [String(s._id), s.name]));
  const devices = await Device.find({ userId: { $in: users.map((u) => u._id) } }).lean();
  return (
    <>
      <PageTitle sub="Duyệt tài khoản đồng thời duyệt thiết bị đầu tiên">Duyệt đăng ký</PageTitle>
      {users.length === 0 && <Card><Empty>Không có đăng ký nào đang chờ</Empty></Card>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users.map((u) => {
          const dev = devices.filter((d) => String(d.userId) === String(u._id));
          return (
            <Card key={String(u._id)}>
              <div className="flex gap-3">
                <div className="shrink-0">
                  {u.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar} alt="Avatar Google" title="Avatar Google" className="h-16 w-16 rounded-full bg-cream object-cover" />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-cream text-2xl font-bold">{u.name?.[0] ?? "?"}</div>
                  )}
                </div>
                <div className="min-w-0 text-sm">
                  <p className="font-bold">{u.name}</p>
                  {u.googleName && u.googleName !== u.name && <p className="text-xs">Tên Google: {u.googleName}</p>}
                  <p className="truncate text-xs text-ink/70">{u.email}</p>
                  <p>📞 {u.phone}</p>
                  <p>🏪 {stores.get(String(u.storeId))}</p>
                  <p className="text-xs text-ink/60">Đăng ký: {viDateTime(u.registeredAt)}</p>
                </div>
              </div>
              <div className="mt-2 text-xs">
                Thiết bị: {dev.map((d) => <Badge key={String(d._id)}>{d.model || d.os} · {d.browser}</Badge>)}
                {!dev.length && <span className="text-danger">chưa ghi nhận</span>}
              </div>
              <div className="mt-3 grid gap-2">
                <ActionForm action={approveUser} submitLabel="✅ Duyệt" successText="Đã duyệt" variant="secondary" className="flex flex-wrap items-center gap-2" buttonClassName="w-28 shrink-0 whitespace-nowrap">
                  <input type="hidden" name="userId" value={String(u._id)} />
                  <Input name="hourlyWage" inputMode="numeric" placeholder={`Lương giờ (thử việc: ${vnd(PROBATION_WAGE)})`} className="min-w-0 flex-1" />
                  <label className="flex w-full items-start gap-2 rounded-lg bg-violet-bg px-2 py-1.5 text-xs text-violet-fg ring-1 ring-violet-line">
                    <input type="checkbox" name="probation" defaultChecked className="mt-0.5 h-4 w-4 accent-[#a855c7]" />
                    <span>
                      <b>Thử việc</b> – lương mặc định {vnd(PROBATION_WAGE)}đ/giờ (nếu để trống ô lương), không dùng Chốt ca / Nhận hàng / Tồn kho. Xong{" "}
                      {TRIAL_SHIFTS} ca thử việc{probCfg.trialHalf ? " (tính 50% giờ công)" : ""} → admin Nhận / Không nhận;{" "}
                      {probCfg.monthOn ? `hết 1 tháng → admin xác nhận lên ${vnd(OFFICIAL_WAGE)}đ/giờ.` : `được nhận là lên chính thức ${vnd(OFFICIAL_WAGE)}đ/giờ.`}
                    </span>
                  </label>
                </ActionForm>
                <ActionForm action={rejectUser} submitLabel="Từ chối" successText="Đã từ chối" variant="outline" className="flex items-center gap-2" buttonClassName="w-28 shrink-0 whitespace-nowrap">
                  <input type="hidden" name="userId" value={String(u._id)} />
                  <Input name="reason" placeholder="Lý do từ chối" className="flex-1" />
                </ActionForm>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
