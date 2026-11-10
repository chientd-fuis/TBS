import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { APPROVED_SHIFT, Attendance, ShiftAssignment, Store } from "@/lib/models";
import { localDate, localTime, viDate } from "@/lib/time";
import { Badge, Card } from "@/components/ui";
import CheckInWidget from "@/components/user/CheckInWidget";
import { anyMethods, methodsOf } from "@/lib/checkin-methods";
import { goodsEnabled, stockEnabled } from "@/lib/goods-server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const open = await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean();
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
  const cand = await Store.find({ _id: { $in: [...new Set(candIds)] } }).select("name checkFace checkGps checkWifi wifiName").lean();
  const methods = cand.length ? anyMethods(cand.map(methodsOf)) : methodsOf(store);
  const goodsOn = await goodsEnabled();
  const stockOn = goodsOn && (await stockEnabled());
  const wifiNames = [...new Set(cand.filter((c) => methodsOf(c).wifi && c.wifiName).map((c) => c.wifiName!))];

  return (
    <>
      <CheckInWidget
        methods={methods}
        wifiNames={wifiNames}
        openSince={open ? localTime(open.checkInAt, tz) : null}
        storeName={(open && supportOf(open.storeId)) || store?.name || ""}
        supportNote={
          open && supportOf(open.storeId)
            ? `Bạn đang hỗ trợ ${supportOf(open.storeId)} – check-out tại đó`
            : supportToday.length
              ? `Hôm nay bạn có ca hỗ trợ ở ${supportToday.join(", ")} – tới đó bấm CHECK-IN, app tự nhận cơ sở theo GPS`
              : undefined
        }
      />
      <Link
        href="/closing"
        className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#f1e6c8] hover:bg-primary-light"
      >
        <span>
          <span className="block font-bold text-accent">📷 Chốt ca</span>
          <span className="text-xs text-ink/70">Chụp ảnh tờ chốt ca sáng / chiều / tối. Không chụp ghi nhận 1 lỗi phạt</span>
        </span>
        <span className="text-xl text-accent">›</span>
      </Link>
      {goodsOn && (
      <Link
        href="/receive"
        className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#f1e6c8] hover:bg-primary-light"
      >
        <span>
          <span className="block font-bold text-accent">📦 Nhận hàng</span>
          <span className="text-xs text-ink/70">Chụp ảnh tin nhắn đã nhận hàng trong nhóm Facebook hoặc copy nội dung đã nhận – app tự đọc &amp; ghi</span>
        </span>
        <span className="text-xl text-accent">›</span>
      </Link>
      )}
      {stockOn && (
        <Link
          href="/stock"
          className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm ring-1 ring-[#f1e6c8] hover:bg-primary-light"
        >
          <span>
            <span className="block font-bold text-accent">📋 Tồn kho</span>
            <span className="text-xs text-ink/70">Cuối ngày báo số còn: “tồn 3mn, 1nl, hết sầu múi…”</span>
          </span>
          <span className="text-xl text-accent">›</span>
        </Link>
      )}
      <Card title={`Hôm nay · ${viDate(today)}`}>
        <div className="space-y-2 text-sm">
          <p className="font-semibold text-accent">Ca được xếp</p>
          {shifts.length ? (
            shifts.map((s) => (
              <p key={String(s._id)} className="flex flex-wrap items-center gap-2">
                <span>{s.shiftName}: {s.startTime} – {s.endTime}</span>
                {supportOf(s.storeId) && <Badge tone="blue">Hỗ trợ {supportOf(s.storeId)}</Badge>}
              </p>
            ))
          ) : (
            <p className="text-ink/60">Không có ca</p>
          )}
          <p className="pt-2 font-semibold text-accent">Lượt chấm công</p>
          {todayAtts.length ? (
            todayAtts.map((a) => (
              <div key={String(a._id)} className="flex flex-wrap items-center gap-2">
                <span>
                  {localTime(a.checkInAt, tz)} → {a.checkOutAt ? localTime(a.checkOutAt, tz) : "…"}
                </span>
                {a.roundedHours != null && <Badge tone="yellow">{a.roundedHours}h</Badge>}
                {!!a.lateMinutes && <Badge tone="orange">Muộn {a.lateMinutes}&apos;</Badge>}
                {!!a.earlyMinutes && <Badge tone="orange">Sớm {a.earlyMinutes}&apos;</Badge>}
                {a.source === "ADMIN_MANUAL" && <Badge tone="green">Chấm hộ</Badge>}
                {supportOf(a.storeId) && <Badge tone="blue">Hỗ trợ {supportOf(a.storeId)}</Badge>}
              </div>
            ))
          ) : (
            <p className="text-ink/60">Chưa có</p>
          )}
        </div>
      </Card>
    </>
  );
}
