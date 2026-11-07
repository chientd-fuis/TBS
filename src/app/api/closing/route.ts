import { NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { APPROVED_SHIFT, ShiftAssignment, ShiftClosing, User } from "@/lib/models";
import { checkDeviceForAttendance } from "@/lib/device";
import { distanceMeters } from "@/lib/calc";
import { savePhoto } from "@/lib/drive";
import { deliverClosing } from "@/lib/closing";
import { resolveClosingContext } from "@/lib/closing-context";
import { afterClosing, isDayEndShift } from "@/lib/day-revenue";
import { localMonth, localTime } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

export const maxDuration = 60;

const Money = z.number().int().min(0).max(1_000_000_000);
const Raw = z.string().max(300);
const Body = z.object({
  photos: z.array(z.string()).max(4).default([]), // không bắt buộc
  note: z.string().max(500).optional(),
  // doanh thu ca (bot đọc ảnh → nhân viên kiểm tra / sửa)
  revenue: z.object({
    dt: Money,
    tm: Money,
    tk: Money,
    cp: z.number().int().min(-1_000_000_000).max(1_000_000_000), // thu chi (có thể âm nếu là khoản thu)
    grab: Money.default(0),
    shopee: Money,
  }),
  revenueInput: z
    .object({ dt: Raw, tm: Raw, tk: Raw, cp: Raw, grab: Raw, shopee: Raw })
    .partial()
    .optional(),
  ocr: z
    .object({ status: z.enum(["NONE", "OK", "FAILED"]), values: z.record(z.string(), z.number()).optional(), error: z.string().max(300).optional() })
    .optional(),
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
    if (!parsed.success) throw new HttpError(400, "Số liệu chốt ca chưa hợp lệ");
    // bắt buộc: Doanh thu máy, Tiền mặt, Tài khoản (nhân viên phải gõ, kể cả 0)
    const ri = parsed.data.revenueInput;
    if (ri && (["dt", "tm", "tk"] as const).some((k) => !ri[k]?.trim()))
      throw new HttpError(400, "Nhập đủ Doanh thu máy, Tiền mặt, Tài khoản");
    const b = parsed.data;

    const dev = await checkDeviceForAttendance(user._id);
    if (!dev.ok) throw new HttpError(403, dev.error);
    const ctx = await resolveClosingContext(user, new Date());
    if (!ctx) throw new HttpError(400, "Bạn chưa thuộc cơ sở nào");
    const { store, tz, today, att, shift } = ctx;
    const now = new Date();
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
    const workDate = shift?.date ?? today;
    const isDayEnd = await isDayEndShift(store._id, shift?.startTime);
    const distanceM =
      b.lat != null && b.lng != null && store.lat != null && store.lng != null ? distanceMeters(b.lat, b.lng, store.lat, store.lng) : undefined;
    await ShiftClosing.create({
      _id: id,
      userId: user._id,
      storeId: store._id,
      attendanceId: att?._id,
      workDate,
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
      revenue: b.revenue,
      revenueInput: b.revenueInput,
      ocr: b.ocr ?? { status: "NONE" },
      isDayEnd,
    });
    const status = await deliverClosing(String(id), bufs);
    // cộng doanh thu ngày; ca cuối ngày → ghi Google Sheet
    const sheet = await afterClosing(store._id, workDate, isDayEnd).catch(() => "FAILED" as const);
    return NextResponse.json({
      ok: true,
      telegram: status,
      sheet,
      message:
        status === "SENT"
          ? "Đã chốt ca và gửi ảnh vào nhóm Telegram."
          : status === "DISABLED"
            ? "Đã lưu chốt ca (chưa cấu hình nhóm Telegram – báo admin)."
            : "Đã lưu chốt ca, gửi Telegram chưa được – hệ thống sẽ tự gửi lại.",
      sheetMessage:
        sheet === "SENT"
          ? "Đã ghi doanh thu cả ngày lên Google Sheet."
          : sheet === "FAILED"
            ? "Ghi Google Sheet chưa được – hệ thống sẽ tự ghi lại, admin xem ở mục Chốt ca."
            : null,
    });
  } catch (e) {
    return jsonError(e);
  }
}
