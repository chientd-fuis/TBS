import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdjustmentRequest, AdminLoginLog, APPROVED_SHIFT, Attendance, CoverRequest, Device, PayrollFeedback, ShiftAssignment, Store, User } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { localDate, localMonth, localTime, viMonth } from "@/lib/time";
import { estimateStorePay } from "@/lib/payroll";
import { hoursVi, vnd } from "@/lib/format";
import { shiftWindow } from "@/lib/attendance";
import { Alert, Badge, Card, LinkButton, PageTitle } from "@/components/ui";
import { BellRing, ChevronRight, Receipt } from "lucide-react";
import ActivityFeed from "./activity/ActivityFeed";
import { activityDays, loadActivities, loadSessions } from "./activity/data";

export const dynamic = "force-dynamic";

/** Dashboard hôm nay: ai đang trong ca, ai chưa đến, ai đi muộn (spec 7.3) */
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const settings = await getSettings();
  // việc chờ admin duyệt (hiện nổi bật trên điện thoại)
  const [pCover, pAdj, pFb, pReg, pUsers, pDevices] = await Promise.all([
    CoverRequest.countDocuments({ status: "PENDING" }),
    AdjustmentRequest.countDocuments({ status: "PENDING" }),
    PayrollFeedback.countDocuments({ status: "OPEN" }),
    ShiftAssignment.countDocuments({ status: "PENDING", date: { $gte: localDate(new Date()) } }),
    User.countDocuments({ status: "PENDING" }),
    Device.countDocuments({ status: "PENDING", userId: { $in: await User.find({ status: "ACTIVE" }).distinct("_id") } }),
  ]);
  const todo = [
    { n: pCover, text: "nhờ làm hộ ca", href: "/admin/requests" },
    { n: pAdj, text: "điều chỉnh chấm công", href: "/admin/requests" },
    { n: pFb, text: "phản hồi bảng lương", href: "/admin/requests" },
    { n: pReg, text: "đăng ký ca", href: "/admin/schedule" },
    { n: pUsers, text: "tài khoản mới", href: "/admin/approvals" },
    { n: pDevices, text: "thiết bị mới", href: "/admin/devices" },
  ].filter((x) => x.n > 0);
  const todoTotal = todo.reduce((a, x) => a + x.n, 0);
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const now = new Date();
  const failedLogins =
    admin.kind === "OWNER"
      ? await AdminLoginLog.countDocuments({ kind: "PASSWORD", success: false, createdAt: { $gte: new Date(now.getTime() - 24 * 3600_000) } })
      : 0;

  const blocks = await Promise.all(
    stores.map(async (s) => {
      const tz = s.timezone || "Asia/Ho_Chi_Minh";
      const today = localDate(now, tz);
      const [shifts, atts, users] = await Promise.all([
        ShiftAssignment.find({ storeId: s._id, date: today, ...APPROVED_SHIFT }).lean(),
        Attendance.find({ storeId: s._id, workDate: today }).lean(),
        User.find({ storeId: s._id, status: "ACTIVE" }).select("name").lean(),
      ]);
      const name = new Map(users.map((u) => [String(u._id), u.name]));
      const working = atts.filter((a) => a.status === "OPEN");
      const late = atts.filter((a) => (a.lateMinutes || 0) > 0);
      const absent = shifts.filter((sh) => {
        const { start } = shiftWindow(sh.date, sh.startTime!, sh.endTime!, tz);
        return start < now && !atts.some((a) => String(a.userId) === String(sh.userId));
      });
      const missing = await Attendance.countDocuments({ storeId: s._id, status: "MISSING_CHECKOUT" });
      const month = localMonth(now, tz);
      const pay = await estimateStorePay(s._id, month);
      return { s, tz, shifts, working, late, absent, name, missing, month, pay, noCoords: s.lat == null || s.lng == null };
    }),
  );

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle sub="Tình hình chấm công hôm nay">Tổng quan</PageTitle>
        <LinkButton href="/admin/finance/expenses" variant="secondary" className="mb-4 py-2.5">
          <Receipt size={18} /> Nhập chi phí (sao kê / CK)
        </LinkButton>
      </div>
      {todoTotal > 0 && (
        <div className="mb-4 overflow-hidden rounded-2xl bg-[#fff4e5] ring-1 ring-warn/40 lg:hidden">
          <Link href={todo[0].href} className="flex items-center gap-2 px-4 py-3 text-warn">
            <BellRing size={20} className="shrink-0" />
            <span className="flex-1 font-bold">Bạn đang có {todoTotal} yêu cầu chưa duyệt</span>
            <ChevronRight size={18} />
          </Link>
          <ul className="divide-y divide-warn/15 border-t border-warn/20 bg-white/60 text-sm">
            {todo.map((x) => (
              <li key={x.text}>
                <Link href={x.href} className="flex items-center justify-between px-4 py-2 text-ink">
                  <span>
                    <b>{x.n}</b> {x.text}
                  </span>
                  <span className="text-xs text-accent">Duyệt ›</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error === "owner-only" && <Alert tone="red">Chức năng này chỉ dành cho Chủ.</Alert>}
      {!settings.googleRefreshTokenEnc && (
        <Alert tone="orange">
          Chưa kết nối Google Drive để lưu ảnh chấm công – ảnh đang được giữ tạm.{" "}
          {admin.kind === "OWNER" ? <Link className="underline" href="/admin/settings">Kết nối ngay</Link> : "Hãy báo Chủ kết nối."}
        </Alert>
      )}
      {failedLogins >= 5 && (
        <Alert tone="red">
          ⚠️ {failedLogins} lần nhập sai mật khẩu admin trong 24 giờ qua. <Link className="underline" href="/admin/settings">Xem lịch sử</Link> – cân nhắc đổi mật khẩu.
        </Alert>
      )}
      {!settings.adminPasswordHash && admin.kind === "OWNER" && (
        <Alert tone="yellow">
          Chưa đặt mật khẩu admin chung. <Link className="underline" href="/admin/settings">Đặt mật khẩu</Link>
        </Alert>
      )}
      {blocks.length > 1 && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-accent">💰 Tổng lương tạm tính tất cả cơ sở – tháng này (đến hôm nay)</span>
            <span className="text-2xl font-bold text-secondary-dark">{vnd(blocks.reduce((t, b) => t + b.pay.total, 0))}</span>
          </div>
          <p className="mt-1 text-xs text-ink/60">
            Tính từ các lượt đã check-out × lương giờ + thưởng − phạt; chưa gồm phụ cấp / tạm ứng. Bảng lương chính thức lập ở mục Bảng lương.
          </p>
        </Card>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {blocks.map((b) => (
          <Card key={String(b.s._id)} title={b.s.name}>
            {b.noCoords && (
              <Alert tone="red">
                Chưa có toạ độ – nhân viên chưa thể chấm công. <Link className="underline" href="/admin/stores">Cập nhật</Link>
              </Alert>
            )}
            <div className="mt-2 grid grid-cols-4 gap-2 text-center text-sm">
              <div className="rounded-xl bg-primary-light p-2"><p className="text-xs">Ca hôm nay</p><p className="text-xl font-bold">{b.shifts.length}</p></div>
              <div className="rounded-xl bg-[#e3f3e7] p-2"><p className="text-xs">Đang làm</p><p className="text-xl font-bold text-secondary-dark">{b.working.length}</p></div>
              <div className="rounded-xl bg-[#ffe8d9] p-2"><p className="text-xs">Đi muộn</p><p className="text-xl font-bold text-warn">{b.late.length}</p></div>
              <div className="rounded-xl bg-[#fde2e2] p-2"><p className="text-xs">Chưa đến</p><p className="text-xl font-bold text-danger">{b.absent.length}</p></div>
            </div>
            <div className="mt-2 rounded-xl bg-cream p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-accent">💰 Lương tạm tính tháng {viMonth(b.month)} (đến hôm nay)</span>
                <span className="text-xl font-bold text-secondary-dark">{vnd(b.pay.total)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/70">
                <span>{hoursVi(b.pay.hours)} giờ công · {b.pay.staffCount} NV</span>
                <span>Lương cơ bản {vnd(b.pay.basePay)}</span>
                {b.pay.bonus > 0 && <span className="text-bonus">+ Thưởng {vnd(b.pay.bonus)}</span>}
                {b.pay.penalty > 0 && <span className="text-danger">− Phạt {vnd(b.pay.penalty)}</span>}
                <Link className="ml-auto text-accent underline" href={`/admin/attendance?store=${b.s._id}&month=${b.month}`}>Xem chấm công</Link>
              </div>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              {b.working.map((a) => (
                <p key={String(a._id)}>
                  🟢 {b.name.get(String(a.userId))} – vào {localTime(a.checkInAt, b.tz)}{" "}
                  {!!a.lateMinutes && <Badge tone="orange">Muộn {a.lateMinutes}&apos;</Badge>}
                </p>
              ))}
              {b.absent.map((sh) => (
                <p key={String(sh._id)}>🔴 {b.name.get(String(sh.userId)) || "?"} – ca {sh.startTime} chưa check-in</p>
              ))}
              {b.missing > 0 && (
                <p className="text-danger">
                  ⚠️ {b.missing} lượt quên check-out cần xử lý – <Link className="underline" href={`/admin/attendance?store=${b.s._id}&status=MISSING_CHECKOUT`}>xem</Link>
                </p>
              )}
            </div>
          </Card>
        ))}
      </div>
      {admin.kind === "OWNER" && <AdminActivityCard />}
    </>
  );
}

/** Cuối trang tổng quan (Chủ): hoạt động của admin hôm nay + hôm qua. */
async function AdminActivityCard() {
  const days = activityDays();
  const [rows, sessions] = await Promise.all([loadActivities({ days: days.slice(0, 2), limit: 300 }), loadSessions()]);
  const online = sessions.filter((s) => s.online);
  const SHOW = 40;
  return (
    <Card
      title={`Hoạt động admin – hôm nay & hôm qua (${rows.length})`}
      actions={
        <Link className="flex items-center text-sm text-accent underline" href="/admin/activity">
          Xem 7 ngày / quản lý <ChevronRight size={16} />
        </Link>
      }
    >
      <p className="mb-2 text-xs text-ink/60">
        {online.length ? (
          <>
            🟢 Đang online: <b>{online.map((s) => s.name).join(", ")}</b>
          </>
        ) : (
          "Không có admin nào đang online"
        )}
        {sessions.length > online.length && ` · ${sessions.length - online.length} phiên khác còn đăng nhập`}
      </p>
      <div className="max-h-[32rem] overflow-y-auto">
        <ActivityFeed rows={rows.slice(0, SHOW)} today={days[0]} empty="Hôm nay và hôm qua chưa có admin nào thao tác" />
      </div>
      {rows.length > SHOW && (
        <Link className="mt-2 block text-center text-sm text-accent underline" href="/admin/activity">
          Xem thêm {rows.length - SHOW} hoạt động
        </Link>
      )}
    </Card>
  );
}
