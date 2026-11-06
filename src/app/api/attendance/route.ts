import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { Attendance, Device, Store } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { checkDeviceForAttendance } from "@/lib/device";
import { distanceMeters } from "@/lib/calc";
import { assertNotLocked, computeFields, findShiftFor, isStaleOpen, openAttendance } from "@/lib/attendance";
import { audit } from "@/lib/audit";
import { savePhoto } from "@/lib/drive";
import { localDate, localMonth, localTime } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

const Body = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  photo: z.string(),
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
    store: store ? { name: store.name, lat: store.lat, lng: store.lng, radiusM: store.radiusM, timezone: store.timezone } : null,
  });
}

/**
 * POST: chấm công (tự xác định check-in / check-out) – spec 4.2.
 * Thứ tự kiểm tra: thiết bị → vị trí → khuôn mặt → ghi nhận (giờ server).
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

    // 2. Vị trí
    const store = await Store.findById(user.storeId).lean();
    if (!store) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
    if (store.lat == null || store.lng == null)
      throw new HttpError(400, "Cơ sở chưa được cấu hình toạ độ – liên hệ admin", { code: "STORE" });
    if (b.accuracy > settings.maxGpsAccuracyM)
      throw new HttpError(400, `GPS chưa chính xác (sai số ${Math.round(b.accuracy)}m). Ra chỗ thoáng và thử lại.`, {
        code: "GPS_ACCURACY",
      });
    const distance = distanceMeters(b.lat, b.lng, store.lat, store.lng);
    if (distance > (store.radiusM || 100))
      throw new HttpError(400, `Bạn đang cách ${store.name} ${distance}m (cho phép ${store.radiusM}m).`, {
        code: "OUT_OF_RANGE",
        distance,
      });

    // 3. Khuôn mặt: trình duyệt chỉ cho chụp khi phát hiện có khuôn mặt trong khung (không so khớp ảnh mẫu)

    const tz = store.timezone || "Asia/Ho_Chi_Minh";
    const now = new Date(); // giờ server
    const photoBuf = dataUrlToBuffer(b.photo);
    const stamp = `${localDate(now, tz).replace(/-/g, "")}_${localTime(now, tz).replace(/:/g, "")}`;
    let open = await openAttendance(user._id);
    // Lượt mở từ hôm trước bị quên check-out (cron chưa kịp chạy) → đóng lại, lần bấm này là CHECK-IN mới
    if (open && (await isStaleOpen(open, settings.missingCheckoutHours, now.getTime()))) {
      await Attendance.updateOne({ _id: open._id, status: "OPEN" }, { $set: { status: "MISSING_CHECKOUT" } });
      open = null;
    }

    if (open) {
      // ---- CHECK-OUT ----
      const mins = (now.getTime() - open.checkInAt.getTime()) / 60000;
      if (mins < settings.minCheckoutMinutes)
        throw new HttpError(400, `Bạn vừa check-in lúc ${localTime(open.checkInAt, tz)} – chưa thể check-out ngay.`, {
          code: "TOO_SOON",
        });
      await assertNotLocked(open.storeId, open.month);
      const photo = await savePhoto(photoBuf, {
        storeId: String(store._id),
        userId: String(user._id),
        userFolderName: user.name || user.email,
        month: open.month,
        fileName: `${stamp}_out.jpg`,
        target: `attendance:${open._id}:out`,
      });
      const fields = await computeFields({
        storeId: open.storeId,
        shiftAssignmentId: open.shiftAssignmentId,
        checkInAt: open.checkInAt,
        checkOutAt: now,
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
            checkOutPhotoId: photo.driveId,
            checkOutPendingPhotoId: photo.pendingId,
            checkOutDeviceId: dev.deviceId,
            
            status: "COMPLETED",
          },
        },
        { returnDocument: "after" },
      );
      if (!updated) throw new HttpError(409, "Lượt chấm công đã được check-out");
      return NextResponse.json({
        action: "CHECK_OUT",
        time: localTime(now, tz),
        totalHours: updated.totalHours,
        roundedHours: updated.roundedHours,
        earlyMinutes: updated.earlyMinutes,
        lateMinutes: updated.lateMinutes,
        shiftLabel: updated.shiftLabel,
        outOfShift: updated.outOfShift,
      });
    }

    // ---- CHECK-IN ----
    await assertNotLocked(store._id, localMonth(now, tz));
    const shift = await findShiftFor(user._id, now, tz);
    const id = new Types.ObjectId();
    const photo = await savePhoto(photoBuf, {
      storeId: String(store._id),
      userId: String(user._id),
      userFolderName: user.name || user.email,
      month: localMonth(now, tz),
      fileName: `${stamp}_in.jpg`,
      target: `attendance:${id}:in`,
    });
    const fields = await computeFields({ storeId: store._id, shiftAssignmentId: shift?.a._id, checkInAt: now });
    try {
      await Attendance.create({
        _id: id,
        userId: user._id,
        storeId: store._id,
        ...fields,
        shiftAssignmentId: shift?.a._id,
        shiftLabel: shift ? `${shift.a.shiftName} ${shift.a.startTime}–${shift.a.endTime}` : undefined,
        outOfShift: !shift,
        checkInAt: now,
        checkInLat: b.lat,
        checkInLng: b.lng,
        checkInDistanceM: distance,
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
    return NextResponse.json({
      action: "CHECK_IN",
      time: localTime(now, tz),
      lateMinutes: fields.lateMinutes,
      shiftLabel: shift ? `${shift.a.shiftName} ${shift.a.startTime}–${shift.a.endTime}` : null,
      outOfShift: !shift,
    });
  } catch (e) {
    return jsonError(e);
  }
}
