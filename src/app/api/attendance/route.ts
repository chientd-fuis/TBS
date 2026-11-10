import { after, NextResponse } from "next/server";
import { notifyAttendance } from "@/lib/attendance-notify";
import { Types } from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { APPROVED_SHIFT, Attendance, Device, ShiftAssignment, Store } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { checkDeviceForAttendance, clientInfo } from "@/lib/device";
import { ipAllowed, methodsOf } from "@/lib/checkin-methods";
import { distanceMeters } from "@/lib/calc";
import { assertNotLocked, computeFields, findShiftFor, isStaleOpen, openAttendance, payStoreOf } from "@/lib/attendance";
import { audit } from "@/lib/audit";
import { savePhoto } from "@/lib/drive";
import { addDays, localDate, localMonth, localTime } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

const Body = z.object({
  // vị trí / ảnh chỉ gửi khi cơ sở bật cách chấm tương ứng
  lat: z.number().optional(),
  lng: z.number().optional(),
  accuracy: z.number().optional(),
  photo: z.string().optional(),
  fingerprint: z.string().max(128).optional(),
});

/** GET: trạng thái hiện tại (đang có lượt mở hay không). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ error: "Chưa được duyệt" }, { status: 401 });
  const open = await openAttendance(user._id);
  const store = await Store.findById(user.storeId).lean();
  return NextResponse.json({
    open: open ? { checkInAt: open.checkInAt, shiftLabel: open.shiftLabel } : null,
    // không trả bán kính cho phép / toạ độ (nhân viên không cần biết)
    store: store ? { name: store.name, timezone: store.timezone, methods: methodsOf(store) } : null,
  });
}

/**
 * POST: chấm công (tự xác định check-in / check-out) – spec 4.2.
 * Thứ tự kiểm tra: thiết bị → vị trí / WiFi (theo cài đặt cơ sở) → khuôn mặt → ghi nhận (giờ server).
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Chưa đăng nhập");
    if (user.status !== "ACTIVE") throw new HttpError(403, "Tài khoản chưa được duyệt");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Dữ liệu chấm công không hợp lệ");
    const b = parsed.data;
    const settings = await getSettings();

    // 0. Thiết bị
    const dev = await checkDeviceForAttendance(user._id);
    if (!dev.ok) {
      // spec 4.1.1: không khớp thiết bị → từ chối và ghi log
      await audit({ kind: "USER", name: user.email }, "attendance.device.rejected", { type: "User", id: String(user._id) }, null, { reason: dev.error });
      throw new HttpError(403, dev.error, { code: "DEVICE" });
    }
    if (b.fingerprint) {
      // Fingerprint đổi khi cập nhật trình duyệt/OS → chỉ ghi log để admin xem, không chặn
      const d = await Device.findOne({ deviceId: dev.deviceId }).select("fingerprintHash").lean();
      if (d?.fingerprintHash && d.fingerprintHash !== b.fingerprint)
        await audit({ kind: "USER", name: user.email }, "attendance.device.fingerprintChanged", { type: "Device", id: dev.deviceId });
    }

    const now = new Date(); // giờ server
    let open = await openAttendance(user._id);
    // Lượt mở từ hôm trước bị quên check-out (cron chưa kịp chạy) → đóng lại, lần bấm này là CHECK-IN mới
    if (open && (await isStaleOpen(open, settings.missingCheckoutHours, now.getTime()))) {
      await Attendance.updateOne({ _id: open._id, status: "OPEN" }, { $set: { status: "MISSING_CHECKOUT" } });
      open = null;
    }

    // 2. Xác định cơ sở chấm công theo cách xác thực của từng cơ sở (vị trí / WiFi) – xem lib/checkin-methods.ts
    const home = await Store.findById(user.storeId).lean();
    if (!home) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
    const ip = (await clientInfo()).ip;
    const hasGps = b.lat != null && b.lng != null && b.accuracy != null;
    const distTo = (st: { lat?: number | null; lng?: number | null }) =>
      !hasGps || st.lat == null || st.lng == null ? Infinity : distanceMeters(b.lat!, b.lng!, st.lat, st.lng);
    const action = open ? "check-out" : "check-in";
    type Fail = { status: number; msg: string; code: string };
    /** null = cơ sở này cho chấm. Không nói bán kính / khoảng cách cho nhân viên. */
    const check = (st: typeof home): Fail | null => {
      const m = methodsOf(st);
      if (m.gps) {
        if (st.lat == null || st.lng == null) return { status: 400, msg: `${st.name} chưa được cấu hình vị trí – liên hệ admin`, code: "STORE" };
        if (!hasGps) return { status: 400, msg: "Cần bật vị trí (GPS) để chấm công", code: "NEED_GPS" };
        if (b.accuracy! > settings.maxGpsAccuracyM)
          return { status: 400, msg: `GPS chưa chính xác (sai số ${Math.round(b.accuracy!)}m). Ra chỗ thoáng và thử lại.`, code: "GPS_ACCURACY" };
        if (distTo(st) > (st.radiusM || 100)) return { status: 400, msg: `Hãy đến quán để ${action}.`, code: "OUT_OF_RANGE" };
      }
      if (m.wifi) {
        if (!st.wifiIps?.length) return { status: 400, msg: `${st.name} chưa cài đặt WiFi chấm công – liên hệ admin`, code: "STORE" };
        if (!ipAllowed(ip, st.wifiIps))
          return {
            status: 400,
            msg: `Hãy kết nối WiFi của quán${st.wifiName ? ` (${st.wifiName})` : ""} để ${action}. Tắt 4G / VPN / Chuyển tiếp bảo mật iCloud nếu đang bật.`,
            code: "WIFI",
          };
      }
      return null;
    };
    /** cơ sở có xác thực "đang có mặt tại quán" (vị trí hoặc WiFi) */
    const verified = (st: typeof home) => methodsOf(st).gps || methodsOf(st).wifi;
    const fail = (f: Fail) => new HttpError(f.status, f.msg, { code: f.code });

    let store: typeof home;
    if (open) {
      // check-out phải ở đúng cơ sở đã check-in
      store = (await Store.findById(open.storeId).lean()) ?? home;
      const f = check(store);
      if (f) throw fail(f.code === "OUT_OF_RANGE" ? { ...f, msg: `Hãy đến ${store.name} để check-out.` } : f);
    } else {
      // cơ sở gốc + cơ sở có CA HỖ TRỢ đã duyệt đúng khung giờ hiện tại
      const tzHome = home.timezone || "Asia/Ho_Chi_Minh";
      const today = localDate(now, tzHome);
      const supportIds = await ShiftAssignment.distinct("storeId", {
        userId: user._id,
        storeId: { $ne: home._id },
        date: { $in: [today, addDays(today, -1)] },
        ...APPROVED_SHIFT,
      });
      const supportStores = supportIds.length ? await Store.find({ _id: { $in: supportIds }, active: true }).lean() : [];
      const allowed: (typeof home)[] = [home];
      for (const st of supportStores)
        if (await findShiftFor(user._id, now, st.timezone || tzHome, st._id)) allowed.push(st);
      const results = allowed.map((st) => ({ st, f: check(st) }));
      const isHome = (st: typeof home) => String(st._id) === String(home._id);
      // ưu tiên: cơ sở xác thực được có mặt → cơ sở hỗ trợ (đang có ca) → gần nhất
      const hit = results
        .filter((r) => !r.f)
        .sort((x, y) => Number(verified(y.st)) - Number(verified(x.st)) || Number(isHome(x.st)) - Number(isHome(y.st)) || distTo(x.st) - distTo(y.st))[0];
      if (!hit) {
        // đang đứng ở cơ sở khác nhưng không có ca hỗ trợ ở đó
        const near = (await Store.find({ active: true, _id: { $nin: allowed.map((x) => x._id) } }).lean()).find((st) => verified(st) && !check(st));
        if (near)
          throw new HttpError(400, `Bạn đang ở ${near.name} nhưng chưa được xếp ca hỗ trợ tại đây (hoặc chưa tới giờ ca). Liên hệ admin để được xếp ca.`, {
            code: "NOT_ASSIGNED",
          });
        throw fail(results[0].f!);
      }
      store = hit.st;
    }
    const dist = distTo(store);
    const distance = Number.isFinite(dist) ? dist : undefined;
    const isSupport = String(store._id) !== String(home._id);

    // 3. Khuôn mặt: trình duyệt chỉ cho chụp khi phát hiện có khuôn mặt trong khung (không so khớp ảnh mẫu)
    if (methodsOf(store).face && !b.photo) throw new HttpError(400, "Cần chụp ảnh khuôn mặt để chấm công", { code: "NEED_FACE" });

    const tz = store.timezone || "Asia/Ho_Chi_Minh";
    const photoBuf = b.photo ? dataUrlToBuffer(b.photo) : null;
    const stamp = `${localDate(now, tz).replace(/-/g, "")}_${localTime(now, tz).replace(/:/g, "")}`;

    if (open) {
      // ---- CHECK-OUT ----
      const mins = (now.getTime() - open.checkInAt.getTime()) / 60000;
      if (mins < settings.minCheckoutMinutes)
        throw new HttpError(400, `Bạn vừa check-in lúc ${localTime(open.checkInAt, tz)} – chưa thể check-out ngay.`, {
          code: "TOO_SOON",
        });
      await assertNotLocked(payStoreOf(open), open.month, open.userId);
      const photo = photoBuf
        ? await savePhoto(photoBuf, {
            storeId: String(store._id),
            userId: String(user._id),
            userFolderName: user.name || user.email,
            month: open.month,
            fileName: `${stamp}_out.jpg`,
            target: `attendance:${open._id}:out`,
          })
        : {};
      const fields = await computeFields({
        storeId: open.storeId,
        shiftAssignmentId: open.shiftAssignmentId,
        checkInAt: open.checkInAt,
        checkOutAt: now,
        extraHours: open.extraHours,
      });
      const updated = await Attendance.findOneAndUpdate(
        { _id: open._id, status: "OPEN" }, // điều kiện → bấm 2 lần không ghi đè
        {
          $set: {
            ...fields,
            checkOutAt: now,
            checkOutLat: b.lat,
            checkOutLng: b.lng,
            checkOutDistanceM: distance,
            checkOutIp: ip || undefined,
            checkOutPhotoId: photo.driveId,
            checkOutPendingPhotoId: photo.pendingId,
            checkOutDeviceId: dev.deviceId,
            
            status: "COMPLETED",
          },
        },
        { returnDocument: "after" },
      );
      if (!updated) throw new HttpError(409, "Lượt chấm công đã được check-out");
      // thông báo nhóm chấm công (chạy sau khi đã trả kết quả cho nhân viên)
      after(() =>
        notifyAttendance(
          store._id,
          {
            action: "CHECK_OUT",
            storeName: store.name,
            employeeName: user.name || user.email,
            tz,
            workDate: updated.workDate,
            checkInAt: updated.checkInAt,
            checkOutAt: now,
            shiftLabel: updated.shiftLabel,
            outOfShift: updated.outOfShift,
            lateMinutes: updated.lateMinutes,
            earlyMinutes: updated.earlyMinutes,
            totalHours: updated.totalHours,
            roundedHours: updated.roundedHours,
            supportFrom: isSupport ? home.name : null,
          },
          photoBuf,
        ),
      );
      return NextResponse.json({
        action: "CHECK_OUT",
        time: localTime(now, tz),
        totalHours: updated.totalHours,
        roundedHours: updated.roundedHours,
        earlyMinutes: updated.earlyMinutes,
        lateMinutes: updated.lateMinutes,
        shiftLabel: updated.shiftLabel,
        outOfShift: updated.outOfShift,
        storeName: store.name,
        support: isSupport,
      });
    }

    // ---- CHECK-IN ----
    await assertNotLocked(home._id, localMonth(now, tz), user._id); // bảng lương ở cơ sở gốc
    const shift = await findShiftFor(user._id, now, tz, store._id);
    const id = new Types.ObjectId();
    const photo = photoBuf
      ? await savePhoto(photoBuf, {
          storeId: String(store._id),
          userId: String(user._id),
          userFolderName: user.name || user.email,
          month: localMonth(now, tz),
          fileName: `${stamp}_in.jpg`,
          target: `attendance:${id}:in`,
        })
      : {};
    const fields = await computeFields({ storeId: store._id, shiftAssignmentId: shift?.a._id, checkInAt: now });
    try {
      await Attendance.create({
        _id: id,
        userId: user._id,
        storeId: store._id,
        homeStoreId: home._id,
        ...fields,
        shiftAssignmentId: shift?.a._id,
        shiftLabel: fields.shiftLabel ?? undefined,
        outOfShift: !shift,
        checkInAt: now,
        checkInLat: b.lat,
        checkInLng: b.lng,
        checkInDistanceM: distance,
        checkInIp: ip || undefined,
        checkInPhotoId: photo.driveId,
        checkInPendingPhotoId: photo.pendingId,
        checkInDeviceId: dev.deviceId,
        
        source: "SELF",
        status: "OPEN",
      });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new HttpError(409, "Bạn đã check-in rồi");
      throw e;
    }
    after(() =>
      notifyAttendance(
        store._id,
        {
          action: "CHECK_IN",
          storeName: store.name,
          employeeName: user.name || user.email,
          tz,
          workDate: fields.workDate!,
          checkInAt: now,
          shiftLabel: fields.shiftLabel ?? null,
          outOfShift: !shift,
          lateMinutes: fields.lateMinutes,
          supportFrom: isSupport ? home.name : null,
        },
        photoBuf,
      ),
    );
    return NextResponse.json({
      action: "CHECK_IN",
      time: localTime(now, tz),
      lateMinutes: fields.lateMinutes,
      shiftLabel: fields.shiftLabel ?? null,
      outOfShift: !shift,
      storeName: store.name,
      support: isSupport,
    });
  } catch (e) {
    return jsonError(e);
  }
}
