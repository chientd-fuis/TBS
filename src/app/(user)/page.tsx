import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { APPROVED_SHIFT, Attendance, ShiftAssignment, Store, User } from "@/lib/models";
import { localDate, localTime, viDate, zonedToDate } from "@/lib/time";
import { Badge } from "@/components/ui";
import { Camera, ChevronRight, Package } from "lucide-react";
import { minutesVi } from "@/lib/format";
import CheckInWidget from "@/components/user/CheckInWidget";
import { anyMethods, methodsOf } from "@/lib/checkin-methods";
import { goodsEnabled, stockEnabled } from "@/lib/goods-server";
import { isProbation, probationConfig, probationEnd, TRIAL_SHIFTS } from "@/lib/probation";
import { AUTO_LOCK_MS, checkinLock, checkoutCap, runAutoCheckout } from "@/lib/auto-checkout";
import WhatsNew from "@/components/WhatsNew";
import { unseenFor } from "@/lib/announcements";
import { ReminderBoard } from "@/components/ShiftReminders";
import { activeRemindersFor } from "@/lib/reminders";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  let open = await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean();
  // đang trong ca ở cơ sở bật chốt công ca tối → quá hạn check-out thì ghi quên check-out ngay, trước khi hiện nút
  if (open && (await Store.exists({ _id: open.storeId, autoCheckoutOn: true }))) {
    await runAutoCheckout();
    open = await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean();
  }
  // vẫn đang trong ca nhưng đã quá giờ chốt ca tối → nhắc: công chỉ tính tới giờ chốt, check-out trước hạn
  const cap = open ? await checkoutCap(open) : null;
  const capNote = cap
    ? `Đã quá giờ chốt ca tối ${cap.time} – công chỉ tính tới ${cap.time}. Hãy CHECK-OUT trước ${localTime(new Date(cap.cap.getTime() + AUTO_LOCK_MS), tz).slice(0, 5)}, quá giờ sẽ ghi QUÊN CHECK-OUT (không tính công).`
    : undefined;
  // không có lượt mở: vừa bị ghi quên check-out / vừa check-out sau giờ chốt (khoá 2 tiếng) / giờ cấm check-in → nút mờ + lý do
  const lock = open ? null : await checkinLock(user._id, tz);
  const today = localDate(new Date(), tz);
  const shifts = await ShiftAssignment.find({ userId: user._id, date: today, ...APPROVED_SHIFT }).sort({ startTime: 1 }).lean();
  const todayAtts = await Attendance.find({ userId: user._id, workDate: today }).sort({ checkInAt: 1 }).lean();
  // tên các cơ sở khác (ca hỗ trợ / lượt chấm công ở cơ sở khác)
  const otherIds = [...shifts.map((s) => String(s.storeId)), ...todayAtts.map((a) => String(a.storeId)), ...(open ? [String(open.storeId)] : [])].filter(
    (id) => id !== String(user.storeId),
  );
  const otherNames = new Map(
    (await Store.find({ _id: { $in: [...new Set(otherIds)] } }).select("name").lean()).map((x) => [String(x._id), x.name]),
  );
  const supportOf = (storeId: unknown) => otherNames.get(String(storeId));
  const supportToday = [...new Set(shifts.map((s) => supportOf(s.storeId)).filter(Boolean))] as string[];
  // cách chấm công cần chuẩn bị: cơ sở đang check-in (để check-out) hoặc cơ sở gốc + cơ sở hỗ trợ hôm nay
  const candIds = open ? [String(open.storeId)] : [String(user.storeId), ...shifts.map((s) => String(s.storeId))];
  const cand = await Store.find({ _id: { $in: [...new Set(candIds)] } }).select("name checkFace faceDetect checkGps checkWifi wifiName").lean();
  const base = cand.length ? anyMethods(cand.map(methodsOf)) : methodsOf(store);
  // chưa check-in: được chấm ở cơ sở khác dù chưa xếp ca (gửi admin duyệt hỗ trợ) → lấy vị trí nếu có cơ sở nào kiểm tra vị trí
  const anyGps = !open && !base.gps && (await Store.exists({ active: true, checkGps: { $ne: false } }));
  const methods = anyGps ? { ...base, gps: true } : base;
  // nhân viên thử việc: không Chốt ca / Nhận hàng / Tồn kho
  const trial = isProbation(user);
  // 3 ca thử việc: đã xong mấy ca
  const trialDone = trial && user.trialStage === "ON" && user.probationStart ? await Attendance.countDocuments({ userId: user._id, status: "COMPLETED", workDate: { $gte: user.probationStart } }) : 0;
  const trialHalf = trial ? (await probationConfig()).trialHalf : false;
  const goodsOn = !trial && (await goodsEnabled());
  const stockOn = goodsOn && (await stockEnabled());
  // Có gì mới: popup giới thiệu tính năng chưa xem – KHÔNG hiện khi có ca hôm nay mà chưa check-in (đang vội chấm công)
  const waitingCheckin = shifts.length > 0 && !open && !todayAtts.length;
  // Bảng tin Bơ Sầu: nhắc việc của ca đang / sắp làm (popup chưa xem do layout hiện) → không chồng thêm popup Có gì mới
  const board = await activeRemindersFor(user._id).catch(() => []);
  const news = waitingCheckin || board.some((r) => !r.seen)
    ? []
    : await unseenFor(`user:${user._id}`, { kind: "USER", storeId: user.storeId, since: user.joinedAt ?? user.registeredAt ?? null }).catch(() => []);
  const wifiNames = [...new Set(cand.filter((c) => methodsOf(c).wifi && c.wifiName).map((c) => c.wifiName!))];

  // ca đang / sắp làm: ca đầu tiên chưa kết thúc, hết thì ca cuối (ca qua đêm: giờ ra < giờ vào → +1 ngày)
  const nowMs = Date.now();
  const span = (s: { startTime: string; endTime: string }) => {
    const a = zonedToDate(today, s.startTime, tz).getTime();
    let b = zonedToDate(today, s.endTime, tz).getTime();
    if (b <= a) b += 24 * 3600_000;
    return [a, b] as const;
  };
  const cur = shifts.find((s) => span(s)[1] > nowMs) ?? shifts[shifts.length - 1] ?? null;
  // người cùng ca: cùng cơ sở, cùng ngày, giờ ca giao nhau – kèm giờ đã check-in hôm nay
  let coworkers: { name: string; inAt: string | null }[] = [];
  if (cur) {
    const [a, b] = span(cur);
    const mates = (await ShiftAssignment.find({ storeId: cur.storeId, date: today, userId: { $ne: user._id }, ...APPROVED_SHIFT }).select("userId startTime endTime").lean()).filter(
      (m) => {
        const [x, y] = span(m);
        return x < b && y > a;
      },
    );
    const ids = [...new Set(mates.map((m) => String(m.userId)))];
    if (ids.length) {
      const [people, atts] = await Promise.all([
        User.find({ _id: { $in: ids } }).select("name").lean(),
        Attendance.find({ userId: { $in: ids }, workDate: today }).select("userId checkInAt").sort({ checkInAt: 1 }).lean(),
      ]);
      const firstIn = new Map<string, Date>();
      for (const t of atts) if (!firstIn.has(String(t.userId))) firstIn.set(String(t.userId), t.checkInAt);
      coworkers = people.map((p) => {
        const t = firstIn.get(String(p._id));
        return { name: p.name || "?", inAt: t ? localTime(t, tz).slice(0, 5) : null };
      });
    }
  }
  const wd = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"][new Date(`${today}T00:00:00`).getDay()];
  const tile = "flex min-h-28 flex-col gap-2 rounded-2xl bg-card p-3.5 ring-1 ring-line hover:bg-primary-light";

  return (
    <>
      {news.length > 0 && <WhatsNew items={news} as="user" helpHref="/whats-new" />}
      <ReminderBoard items={board} />
      <CheckInWidget
        methods={methods}
        wifiNames={wifiNames}
        openSince={open ? localTime(open.checkInAt, tz) : null}
        lock={lock}
        capNote={capNote}
        shift={cur ? { name: cur.shiftName, start: cur.startTime, end: cur.endTime, startMs: span(cur)[0] } : null}
        openAtMs={open ? new Date(open.checkInAt).getTime() : null}
        dateLabel={`${wd} ${today.slice(8)}/${today.slice(5, 7)}`}
        coworkers={coworkers}
        storeName={(open && supportOf(open.storeId)) || store?.name || ""}
        supportNote={
          open && supportOf(open.storeId)
            ? `Bạn đang làm việc ở ${supportOf(open.storeId)}`
            : supportToday.length
              ? `Hôm nay bạn có ca hỗ trợ ở ${supportToday.join(", ")} – tới đó bấm CHECK-IN, app tự nhận cơ sở theo GPS`
              : undefined
        }
      />
      {trial ? (
        <div className="rounded-2xl bg-primary-light p-4 text-sm ring-1 ring-primary">
          <span className="block font-bold text-accent">🌱 Bạn đang thử việc</span>
          <span className="text-xs text-ink/70">
            {user.trialStage === "ON"
              ? `${trialDone}/${TRIAL_SHIFTS} ca thử việc${trialHalf ? " (ca thử việc tính 50% giờ công)" : ""}. Xong ${TRIAL_SHIFTS} ca, quản lý sẽ xác nhận nhận bạn làm tiếp.`
              : user.trialStage === "PENDING"
                ? "Đã xong 3 ca thử việc – đang chờ quản lý xác nhận. Bạn vẫn chấm công bình thường."
                : `Tháng thử việc${user.probationStart ? ` đến ${viDate(probationEnd(user.probationStart))}` : ""}, hết tháng quản lý xét lên nhân viên chính thức.`}{" "}
            Chốt ca, nhận hàng, tồn kho do nhân viên chính thức làm.
          </span>
        </div>
      ) : (
        <>
          {/* đang trong ca → nhắc chốt ca trước khi về */}
          {open && (
            <Link href="/closing" className="flex items-center gap-3 rounded-2xl bg-primary-light px-3.5 py-3 ring-1 ring-primary hover:brightness-[.98]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-on-primary">
                <Camera size={19} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">Công việc của thu ngân cuối ca</span>
                <span className="block text-xs text-ink/70">Chụp tờ chốt ca – ghi lại thông tin chốt ca</span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-accent" aria-hidden />
            </Link>
          )}
          <section className="space-y-2">
            <h2 className="text-[13px] font-bold tracking-wide text-accent uppercase">Việc trong ca</h2>
            <div className="grid grid-cols-2 gap-2.5">
              <Link href="/closing" className={tile}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-light text-accent">
                  <Camera size={21} aria-hidden />
                </span>
                <span className="text-[15px] font-bold">Chốt ca</span>
                <span className="text-xs text-ink/60">Chụp tờ chốt ca</span>
              </Link>
              {goodsOn && (
                <Link href="/receive" className={tile}>
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-bg text-accent">
                    <Package size={21} aria-hidden />
                  </span>
                  <span className="text-[15px] font-bold">Hàng hoá</span>
                  <span className="text-xs text-ink/60">{stockOn ? "Nhận · Trả · Tồn kho" : "Nhận · Trả hàng"}</span>
                </Link>
              )}
            </div>
          </section>
        </>
      )}
      <section className="space-y-2.5 rounded-2xl bg-card p-3.5 text-sm ring-1 ring-line">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-accent">Hôm nay</h2>
          <Link href="/history" className="text-xs font-semibold text-accent underline">Lịch sử ›</Link>
        </div>
        {shifts.length ? (
          shifts.map((s) => (
            <div key={String(s._id)} className="flex flex-wrap items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
              <span className="flex-1">Ca {s.shiftName}</span>
              {supportOf(s.storeId) && <Badge tone="blue">Hỗ trợ {supportOf(s.storeId)}</Badge>}
              <b>
                {s.startTime} – {s.endTime}
              </b>
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2.5 text-ink/60">
            <span className="h-2 w-2 shrink-0 rounded-full bg-line-strong" aria-hidden />
            <span className="flex-1">Ca được xếp</span>
            <span>Không có ca</span>
          </div>
        )}
        {todayAtts.length ? (
          todayAtts.map((a) => (
            <div key={String(a._id)} className="flex flex-wrap items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${a.checkOutAt ? "bg-line-strong" : "bg-good"}`} aria-hidden />
              <span className="flex-1">
                {localTime(a.checkInAt, tz).slice(0, 5)} → {a.checkOutAt ? localTime(a.checkOutAt, tz).slice(0, 5) : "…"}
              </span>
              {a.roundedHours != null && <Badge tone="yellow">{a.roundedHours}h</Badge>}
              {!!a.lateMinutes && <Badge tone="orange">Đi muộn {minutesVi(a.lateMinutes)}</Badge>}
              {!!a.earlyMinutes && <Badge tone="orange">Về sớm {minutesVi(a.earlyMinutes)}</Badge>}
              {!a.lateMinutes && !a.earlyMinutes && a.shiftAssignmentId && <Badge tone="green">Đúng giờ</Badge>}
              {a.source === "ADMIN_MANUAL" && <Badge tone="green">Chấm hộ</Badge>}
              {supportOf(a.storeId) && <Badge tone="blue">Hỗ trợ {supportOf(a.storeId)}</Badge>}
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2.5 text-ink/60">
            <span className="h-2 w-2 shrink-0 rounded-full bg-line-strong" aria-hidden />
            <span className="flex-1">Lượt chấm công</span>
            <span>Chưa có</span>
          </div>
        )}
      </section>
    </>
  );
}
