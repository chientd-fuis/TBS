import { after, NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { APPROVED_SHIFT, ShiftAssignment, ShiftClosing, User } from "@/lib/models";
import { checkDeviceForAttendance } from "@/lib/device";
import { distanceMeters } from "@/lib/calc";
import { deliverClosing } from "@/lib/closing";
import { resolveClosingContext } from "@/lib/closing-context";
import { afterClosing } from "@/lib/day-revenue";
import { CLOSING_SHIFTS, closingWorkDate, defaultClosingShift } from "@/lib/revenue";
import { addDays, localTime } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

export const maxDuration = 60;

const Money = z.number().int().min(0).max(1_000_000_000);
const Raw = z.string().max(300);
const Body = z.object({
  photos: z.array(z.string()).max(4).default([]), // không bắt buộc
  closingShift: z.enum(["S", "C", "T"]).optional(),
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
    // ảnh chốt ca KHÔNG lưu (Drive / database) – chỉ gửi thẳng vào nhóm Telegram
    const photos: { driveId?: string }[] = [];
    // ca chốt: nhân viên chọn; giờ (8h–16h Sáng, 16h–20h Chiều, 20h–8h Tối) CHỈ dùng để chọn sẵn, không lưu / gửi
    const hour = Number(localTime(now, tz).slice(0, 2));
    const csKey = b.closingShift ?? defaultClosingShift(hour);
    const cs = CLOSING_SHIFTS.find((x) => x.key === csKey)!;
    const workDate = closingWorkDate(csKey, today, hour, addDays);
    const isDayEnd = csKey === "T"; // ca tối = ca cuối ngày → ghi Google Sheet
    const distanceM =
      b.lat != null && b.lng != null && store.lat != null && store.lng != null ? distanceMeters(b.lat, b.lng, store.lat, store.lng) : undefined;
    // 1 ca (cơ sở × ngày × ca chốt) chỉ có 1 bản ghi: chốt lại → cập nhật bản ghi cũ
    const prev = await ShiftClosing.findOne({ storeId: store._id, workDate, shiftName: cs.name }).select("_id").lean();
    const saved = await ShiftClosing.findOneAndUpdate(
      { storeId: store._id, workDate, shiftName: cs.name },
      {
        $set: {
          userId: user._id,
          attendanceId: att?._id,
          shiftLabel: cs.name,
          shiftAssignmentId: shift?._id,
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
          telegram: { status: "PENDING", attempts: 0 },
          webhook: {},
          ...(prev ? { lastEditedAt: now } : {}),
        },
        $unset: { shiftStart: 1, shiftEnd: 1, revenueEditedBy: 1 },
        ...(prev ? { $inc: { editCount: 1 } } : {}),
        $setOnInsert: { _id: id },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();
    const closingId = String(saved!._id);
    const status = await deliverClosing(closingId, bufs);
    // cộng doanh thu ngày; ca cuối ngày → ghi Google Sheet
    const sheet = await afterClosing(store._id, workDate, isDayEnd).catch(() => "FAILED" as const);
    // ca Tối của cơ sở cuối cùng chốt xong → gửi báo cáo ngày vào nhóm Quản lý doanh thu
    if (isDayEnd && !prev)
      after(async () => {
        const { maybeSendDailyAfterClosing } = await import("@/lib/finance-report");
        await maybeSendDailyAfterClosing(workDate).catch(() => null);
      });
    return NextResponse.json({
      ok: true,
      updated: !!prev,
      telegram: status,
      sheet,
      message:
        status === "SENT"
          ? prev
            ? "Đã cập nhật lần chốt ca này và gửi lại vào nhóm Telegram."
            : "Đã chốt ca và gửi vào nhóm Telegram."
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
