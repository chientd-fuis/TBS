import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { APPROVED_SHIFT, Attendance, ShiftAssignment, ShiftClosing, Store, User } from "@/lib/models";
import { findShiftForClosing } from "@/lib/attendance";
import { checkDeviceForAttendance } from "@/lib/device";
import { distanceMeters } from "@/lib/calc";
import { savePhoto } from "@/lib/drive";
import { deliverClosing } from "@/lib/closing";
import { localDate, localMonth, localTime } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

export const maxDuration = 60;

const Body = z.object({
  photos: z.array(z.string()).min(1).max(4),
  note: z.string().max(500).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

/** Chốt ca: lưu ảnh (Drive) + gửi vào nhóm Telegram của cơ sở. */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Chưa đăng nhập");
    if (user.status !== "ACTIVE") throw new HttpError(403, "Tài khoản chưa được duyệt");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Cần 1–4 ảnh chụp");
    const b = parsed.data;

    const dev = await checkDeviceForAttendance(user._id);
    if (!dev.ok) throw new HttpError(403, dev.error);
    const home = await Store.findById(user.storeId).lean();
    if (!home) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
    const homeTz = home.timezone || "Asia/Ho_Chi_Minh";
    const now = new Date();
    const homeToday = localDate(now, homeTz);

    // gắn với lượt chấm công đang mở, hoặc lượt gần nhất hôm nay
    const att =
      (await Attendance.findOne({ userId: user._id, status: "OPEN" }).lean()) ??
      (await Attendance.findOne({ userId: user._id, workDate: homeToday }).sort({ checkInAt: -1 }).lean());

    // ca đang chốt (có thể là ca hỗ trợ ở cơ sở khác) + những người cùng ca
    const shift = await findShiftForClosing(user._id, now, homeTz, att?.shiftAssignmentId);
    // chốt ca gửi về nhóm của cơ sở đang làm (lượt chấm công → ca → cơ sở gốc)
    const storeId = att?.storeId ?? shift?.storeId ?? home._id;
    const store = String(storeId) === String(home._id) ? home : ((await Store.findById(storeId).lean()) ?? home);
    const tz = store.timezone || homeTz;
    const today = localDate(now, tz);
    let coworkers: string[] = [];
    if (shift) {
      const mates = await ShiftAssignment.find({
        date: shift.date,
        shiftTemplateId: shift.shiftTemplateId,
        userId: { $ne: user._id },
        ...APPROVED_SHIFT,
      })
        .select("userId")
        .lean();
      coworkers = (await User.find({ _id: { $in: mates.map((m) => m.userId) } }).select("name").lean()).map((u) => u.name).filter(Boolean);
    }

    const bufs = b.photos.map(dataUrlToBuffer);
    const id = new Types.ObjectId();
    const stamp = `${today.replace(/-/g, "")}_${localTime(now, tz).replace(/:/g, "")}`;
    const photos = [];
    for (let i = 0; i < bufs.length; i++) {
      const r = await savePhoto(bufs[i], {
        storeId: String(store._id),
        userId: String(user._id),
        userFolderName: `${user.name || user.email}`,
        month: `Chốt ca ${localMonth(now, tz)}`,
        fileName: `${stamp}_chotca_${i + 1}.jpg`,
        target: `closing:${id}:${i}`,
      });
      photos.push({ driveId: r.driveId, pendingId: r.pendingId });
    }
    const distanceM =
      b.lat != null && b.lng != null && store.lat != null && store.lng != null ? distanceMeters(b.lat, b.lng, store.lat, store.lng) : undefined;
    await ShiftClosing.create({
      _id: id,
      userId: user._id,
      storeId: store._id,
      attendanceId: att?._id,
      workDate: shift?.date ?? today,
      shiftLabel: shift ? `${shift.shiftName} ${shift.startTime}–${shift.endTime}` : att?.shiftLabel?.replace(/^Ca\s*/i, ""),
      shiftAssignmentId: shift?._id,
      shiftName: shift?.shiftName,
      shiftStart: shift?.startTime,
      shiftEnd: shift?.endTime,
      checkInAt: att?.checkInAt,
      checkOutAt: att?.checkOutAt,
      coworkers,
      employeeName: user.name || user.googleName || user.email,
      employeePhone: user.phone,
      note: b.note?.trim(),
      lat: b.lat,
      lng: b.lng,
      distanceM,
      deviceId: dev.deviceId,
      photos,
    });
    const status = await deliverClosing(String(id), bufs);
    return NextResponse.json({
      ok: true,
      telegram: status,
      message:
        status === "SENT"
          ? "Đã chốt ca và gửi ảnh vào nhóm Telegram."
          : status === "DISABLED"
            ? "Đã lưu chốt ca (chưa cấu hình nhóm Telegram – báo admin)."
            : "Đã lưu chốt ca, gửi Telegram chưa được – hệ thống sẽ tự gửi lại.",
    });
  } catch (e) {
    return jsonError(e);
  }
}
