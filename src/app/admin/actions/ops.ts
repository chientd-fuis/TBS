"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { connectDB } from "@/lib/db";
import {
  AdjustmentRequest,
  Attendance,
  AttendanceAdjustment,
  BonusPenalty,
  Payroll,
  PayrollItem,
  PayrollFeedback,
  APPROVED_SHIFT,
  ShiftAssignment,
  ShiftTemplate,
  Store,
  User,
} from "@/lib/models";
import { assertAdmin, assertPerm } from "@/lib/guards";
import { adminActor, type AdminSession } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { assertNotLocked, computeFields, findShiftFor, isMonthLocked, payStoreOf, storeTz } from "@/lib/attendance";
import { addDays, localMonth, zonedToDate } from "@/lib/time";
import { generatePayroll, publishPayroll, updateItemExtras } from "@/lib/payroll";
import { upsertAttendance } from "@/lib/attendance-admin";
import { errMsg, num, str, type FormState } from "./types";
import { extractSheetId } from "@/lib/revenue";
import { normalizeIp, parseIpList } from "@/lib/checkin-methods";
import { clientInfo } from "@/lib/device";

/** IP Internet của máy admin đang dùng (để điền IP WiFi quán khi admin đang kết nối WiFi quán). */
export async function currentPublicIp(): Promise<{ ip: string; raw: string }> {
  await assertPerm("stores");
  const raw = (await clientInfo()).ip;
  return { ip: normalizeIp(raw), raw };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ===== Cửa hàng (spec 3.4) ===== */
export async function saveStore(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("stores");
    await connectDB();
    const id = str(fd.get("id"));
    const data = {
      code: str(fd.get("code")).toUpperCase(),
      name: str(fd.get("name")),
      address: str(fd.get("address")),
      lat: str(fd.get("lat")) ? Number(str(fd.get("lat")).replace(",", ".")) : null,
      lng: str(fd.get("lng")) ? Number(str(fd.get("lng")).replace(",", ".")) : null,
      radiusM: num(fd.get("radiusM"), 100) || 100,
      timezone: str(fd.get("timezone")) || "Asia/Ho_Chi_Minh",
      telegramChatId: str(fd.get("telegramChatId")),
      telegramAttendanceChatId: str(fd.get("telegramAttendanceChatId")),
      revenueSheetId: extractSheetId(str(fd.get("revenueSheetId"))),
      revenueTabPattern: str(fd.get("revenueTabPattern")) || "T{m}",
      revenueFirstRow: Math.max(1, num(fd.get("revenueFirstRow"), 3) || 3),
      revenueSheetLayout: str(fd.get("revenueSheetLayout")) === "LEGACY" ? "LEGACY" : "GRAB_COL",
      active: fd.get("active") === "on",
      // cách xác thực chấm công
      checkFace: fd.get("checkFace") === "on",
      checkGps: fd.get("checkGps") === "on",
      checkWifi: fd.get("checkWifi") === "on",
      wifiName: str(fd.get("wifiName")).slice(0, 60),
      wifiIps: parseIpList(str(fd.get("wifiIps"))),
    };
    if (str(fd.get("revenueSheetId")) && !data.revenueSheetId) return { error: "Link Google Sheet không hợp lệ" };
    if (!data.code || !data.name) return { error: "Nhập mã và tên cơ sở" };
    if (!data.checkFace && !data.checkGps && !data.checkWifi) return { error: "Bật ít nhất 1 cách chấm công (khuôn mặt / vị trí / WiFi)" };
    if (data.checkGps && data.lat == null) return { error: "Đã bật chấm công theo vị trí – nhập toạ độ cơ sở" };
    if (data.checkWifi && !data.wifiIps.length) return { error: "Đã bật chấm công theo WiFi – nhập ít nhất 1 IP WiFi của quán (bấm \"Lấy IP mạng đang dùng\" khi đang kết nối WiFi quán)" };
    if (str(fd.get("wifiIps")) && !data.wifiIps.length) return { error: "IP WiFi không hợp lệ" };
    if ((data.lat != null && !Number.isFinite(data.lat)) || (data.lng != null && !Number.isFinite(data.lng)))
      return { error: "Toạ độ không hợp lệ" };
    if ((data.lat == null) !== (data.lng == null)) return { error: "Nhập đủ cả vĩ độ và kinh độ" };
    if (data.lat != null && (Math.abs(data.lat) > 90 || Math.abs(data.lng!) > 180)) return { error: "Toạ độ không hợp lệ" };
    const dup = await Store.findOne(id ? { code: data.code, _id: { $ne: id } } : { code: data.code }).lean();
    if (dup) return { error: "Mã cơ sở đã tồn tại" };
    if (id) {
      const before = await Store.findById(id).lean();
      await Store.updateOne({ _id: id }, { $set: data });
      await audit(adminActor(admin), "store.update", { type: "Store", id }, before, data);
    } else {
      const s = await Store.create(data);
      await audit(adminActor(admin), "store.create", { type: "Store", id: String(s._id) }, null, data);
    }
    revalidatePath("/admin/stores");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Ca làm việc (spec 3.2) ===== */
export async function saveShiftTemplate(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const data = {
      storeId: str(fd.get("storeId")),
      name: str(fd.get("name")),
      startTime: str(fd.get("startTime")),
      endTime: str(fd.get("endTime")),
      active: fd.get("active") !== "off",
    };
    if (!data.storeId || !data.name) return { error: "Chọn cơ sở và nhập tên ca" };
    if (!TIME_RE.test(data.startTime) || !TIME_RE.test(data.endTime)) return { error: "Giờ không hợp lệ (HH:mm)" };
    if (data.startTime === data.endTime) return { error: "Giờ bắt đầu và kết thúc phải khác nhau" };
    if (id) await ShiftTemplate.updateOne({ _id: id }, { $set: data });
    else await ShiftTemplate.create(data);
    await audit(adminActor(admin), id ? "shift.template.update" : "shift.template.create", { type: "ShiftTemplate", id }, null, data);
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Xếp ca hàng loạt: nhiều nhân viên × khoảng ngày × thứ trong tuần. */
export async function assignShifts(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const tpl = await ShiftTemplate.findById(str(fd.get("templateId"))).lean();
    if (!tpl) return { error: "Chọn ca" };
    const userIds = fd.getAll("userIds").map(String).filter(Boolean);
    if (!userIds.length) return { error: "Chọn ít nhất 1 nhân viên" };
    const from = str(fd.get("from"));
    const to = str(fd.get("to")) || from;
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return { error: "Khoảng ngày không hợp lệ" };
    if (addDays(from, 62) < to) return { error: "Tối đa 62 ngày mỗi lần" };
    const weekdays = fd.getAll("weekdays").map(Number);
    let n = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const wd = new Date(d + "T00:00:00Z").getUTCDay();
      if (weekdays.length && !weekdays.includes(wd)) continue;
      for (const uid of userIds) {
        const r = await ShiftAssignment.updateOne(
          { userId: uid, date: d, shiftTemplateId: tpl._id },
          { $set: { storeId: tpl.storeId, startTime: tpl.startTime, endTime: tpl.endTime, shiftName: tpl.name, status: "APPROVED", source: "BULK", decidedBy: adminActor(admin).name, decidedAt: new Date() } },
          { upsert: true },
        );
        n += r.upsertedCount;
      }
    }
    await audit(adminActor(admin), "shift.assign", { type: "ShiftTemplate", id: String(tpl._id) }, null, { userIds, from, to, weekdays, created: n });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function removeAssignment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const a = await ShiftAssignment.findByIdAndDelete(id).lean();
    await audit(adminActor(admin), "shift.unassign", { type: "ShiftAssignment", id }, a, null);
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Copy lịch tuần trước sang tuần đang xem. */
export async function copyPrevWeek(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const storeId = str(fd.get("storeId"));
    const weekStart = str(fd.get("weekStart"));
    const prev = await ShiftAssignment.find({ storeId, date: { $gte: addDays(weekStart, -7), $lt: weekStart }, ...APPROVED_SHIFT }).lean();
    let n = 0;
    for (const a of prev) {
      const r = await ShiftAssignment.updateOne(
        { userId: a.userId, date: addDays(a.date, 7), shiftTemplateId: a.shiftTemplateId },
        { $setOnInsert: { storeId, startTime: a.startTime, endTime: a.endTime, shiftName: a.shiftName, status: "APPROVED", source: "BULK" } },
        { upsert: true },
      );
      n += r.upsertedCount;
    }
    await audit(adminActor(admin), "shift.copyWeek", { type: "Store", id: storeId }, null, { weekStart, created: n });
    revalidatePath("/admin/shifts");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Chấm công: chấm hộ / sửa / xoá (spec 3.5, 7.1) – logic ghi ở lib/attendance-admin.ts ===== */
/** Chấm công hộ – không cần nhân viên xác nhận (spec 3.5). */
export async function manualAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await upsertAttendance(admin, {
      userId: str(fd.get("userId")),
      date: str(fd.get("date")),
      inTime: str(fd.get("inTime")),
      outTime: str(fd.get("outTime")),
      reason: str(fd.get("reason")),
      source: "ADMIN_MANUAL",
      workStoreId: str(fd.get("workStoreId")) || undefined,
    });
    revalidatePath("/admin/attendance");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Chấm công hộ hàng loạt (nhiều ngày / import Excel / AI đọc ảnh) ===== */
/** excelHours: giờ tính công ghi trong file Excel (cột F) – lưu ghi chú để so sánh với giờ hệ thống tính */
export type BulkRow = { k: string; userId: string; date: string; inTime: string; outTime: string | null; excelHours?: number | null };
/** dup = nghi trùng giờ với lượt đã có: VẪN ghi (admin tự kiểm tra lại), chỉ đánh dấu cảnh báo */
export type BulkResult = { k: string; status: "ok" | "created" | "dup" | "error"; msg?: string; dup?: boolean };
const MAX_BULK = 60;

/**
 * dryRun = true: chỉ kiểm tra (trùng lượt đã có, trùng trong danh sách, tháng đã khoá…).
 * dryRun = false: ghi từng lượt; lượt trùng / lỗi bị bỏ qua, các lượt khác vẫn ghi.
 * Client gửi theo từng đợt ≤ 60 lượt.
 */
export async function bulkAttendance(input: { rows: BulkRow[]; reason: string; dryRun: boolean }): Promise<{ error?: string; results?: BulkResult[] }> {
  try {
    const admin = await assertAdmin();
    const reason = (input.reason ?? "").trim();
    if (!input.dryRun && reason.length < 3) return { error: "Bắt buộc nhập lý do" };
    if (!Array.isArray(input.rows) || input.rows.length > MAX_BULK) return { error: `Tối đa ${MAX_BULK} lượt mỗi lần gửi` };
    await connectDB();
    const uids = [...new Set(input.rows.map((r) => r.userId).filter((i) => Types.ObjectId.isValid(i)))];
    const users = new Map((await User.find({ _id: { $in: uids } }).select("storeId name").lean()).map((u) => [String(u._id), u]));
    const tzOf = new Map<string, string>();
    const results: BulkResult[] = [];
    const done: { userId: string; date: string }[] = [];
    const taken = new Map<string, [number, number][]>(); // userId|date → khoảng giờ đã có (DB + trong danh sách)
    for (const r of input.rows) {
      try {
        const u = users.get(r.userId);
        if (!u?.storeId) throw new Error("Chưa chọn nhân viên");
        if (!DATE_RE.test(r.date)) throw new Error("Ngày không hợp lệ");
        if (!TIME_RE.test((r.inTime ?? "").slice(0, 5))) throw new Error("Giờ vào không hợp lệ");
        if (r.outTime && !TIME_RE.test(r.outTime.slice(0, 5))) throw new Error("Giờ ra không hợp lệ");
        const sk = String(u.storeId);
        if (!tzOf.has(sk)) tzOf.set(sk, await storeTz(u.storeId));
        const tz = tzOf.get(sk)!;
        const a = zonedToDate(r.date, r.inTime.slice(0, 5), tz).getTime();
        let b = r.outTime ? zonedToDate(r.date, r.outTime.slice(0, 5), tz).getTime() : a + 3600_000;
        if (b <= a) b += 24 * 3600_000;
        const key = `${r.userId}|${r.date}`;
        if (!taken.has(key)) {
          const ex = await Attendance.find({ userId: r.userId, checkInAt: { $gte: new Date(a - 30 * 3600_000), $lte: new Date(b + 6 * 3600_000) } })
            .select("checkInAt checkOutAt")
            .lean();
          taken.set(key, ex.map((x) => [x.checkInAt.getTime(), x.checkOutAt ? x.checkOutAt.getTime() : x.checkInAt.getTime() + 3600_000]));
        }
        const list = taken.get(key)!;
        // nghi trùng giờ với lượt đã có / trong danh sách → vẫn ghi, chỉ cảnh báo để admin kiểm tra tay
        const dup = list.some(([x, y]) => a < y && b > x);
        if (input.dryRun) {
          await assertNotLocked(u.storeId, localMonth(new Date(a), tz), u._id);
          list.push([a, b]);
          results.push(dup ? { k: r.k, status: "dup", dup, msg: "Nghi trùng giờ với lượt đã có – vẫn ghi, kiểm tra lại" } : { k: r.k, status: "ok" });
          continue;
        }
        await upsertAttendance(admin, { userId: r.userId, date: r.date, inTime: r.inTime.slice(0, 5), outTime: r.outTime ? r.outTime.slice(0, 5) : "", reason, source: "ADMIN_MANUAL", quiet: true, pastMissingOut: true, note: typeof r.excelHours === "number" ? `Excel F: ${String(r.excelHours).replace(".", ",")}h` : undefined });
        list.push([a, b]);
        done.push({ userId: r.userId, date: r.date });
        results.push({ k: r.k, status: "created", ...(dup ? { dup, msg: "Nghi trùng giờ – đã ghi, kiểm tra lại" } : {}) });
      } catch (e) {
        results.push({ k: r.k, status: "error", msg: (e as Error).message || "Lỗi" });
      }
    }
    if (!input.dryRun && results.some((x) => x.status === "created")) {
      const dates = done.map((d) => d.date).sort();
      await audit(adminActor(admin), "attendance.bulk", { type: "Attendance" }, null, {
        reason,
        created: done.length,
        userIds: [...new Set(done.map((d) => d.userId))],
        from: dates[0],
        to: dates[dates.length - 1],
      });
      revalidatePath("/admin/attendance");
    }
    return { results };
  } catch (e) {
    return { error: (e as Error).message || "Lỗi hệ thống" };
  }
}

export async function editAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const a = await Attendance.findById(id).lean();
    if (!a) return { error: "Không tìm thấy" };
    await upsertAttendance(admin, {
      id,
      userId: String(a.userId),
      date: str(fd.get("date")) || a.workDate,
      inTime: str(fd.get("inTime")),
      outTime: str(fd.get("outTime")),
      // ghi chú (không bắt buộc) – nhân viên xem được ở Lịch sử chấm công
      reason: str(fd.get("note")),
      staffNote: str(fd.get("note")),
      // ô "+0,5h cho ca này": tích = cộng 0,5h vào giờ tính công, bỏ tích = không cộng
      extraHours: fd.get("plusHalf") === "on" ? 0.5 : 0,
      source: "ADMIN_MANUAL",
    });
    revalidatePath("/admin/attendance", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const id = str(fd.get("id"));
    const reason = str(fd.get("reason"));
    if (reason.length < 3) return { error: "Nhập lý do xoá" };
    const a = await Attendance.findById(id);
    if (!a) return { error: "Không tìm thấy" };
    await assertNotLocked(payStoreOf(a), a.month, a.userId);
    await AttendanceAdjustment.create({ attendanceId: a._id, adminName: adminActor(admin).name, action: "DELETE", before: a.toObject(), reason });
    await audit(adminActor(admin), "attendance.delete", { type: "Attendance", id }, a.toObject(), { reason });
    await a.deleteOne();
    revalidatePath("/admin/attendance", "layout");
    redirect(`/admin/attendance?store=${a.storeId}&user=${a.userId}&month=${a.month}`);
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Thưởng / phạt – admin nhập tự do (spec 3.6) ===== */
export async function createBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    // 1 người (userId) hoặc nhiều người cùng lúc (userIds – chọn nhiều)
    const ids = [...new Set([...fd.getAll("userIds"), fd.get("userId")].map((v) => str(v)).filter((v) => /^[a-f\d]{24}$/i.test(v)))];
    if (!ids.length) return { error: "Chọn nhân viên" };
    if (ids.length > 60) return { error: "Tối đa 60 người / lần" };
    const users = await User.find({ _id: { $in: ids } }).select("name storeId").lean();
    if (users.length !== ids.length || users.some((u) => !u.storeId)) return { error: "Có nhân viên không hợp lệ / chưa thuộc cơ sở nào" };
    const kind = str(fd.get("kind")) === "BONUS" ? "BONUS" : "PENALTY";
    const date = str(fd.get("date"));
    const amountVnd = Math.round(num(fd.get("amountVnd")));
    const content = str(fd.get("content"));
    if (!DATE_RE.test(date)) return { error: "Chọn ngày áp dụng" };
    if (amountVnd <= 0) return { error: "Số tiền phải > 0" };
    if (content.length < 3) return { error: "Nhập nội dung" };
    const attendanceId = ids.length === 1 ? str(fd.get("attendanceId")) || undefined : undefined;
    const month = date.slice(0, 7);
    // kiểm tra khoá TẤT CẢ trước → không tạo dở dang
    const locked: string[] = [];
    for (const u of users) if (await isMonthLocked(u.storeId!, month, u._id)) locked.push(u.name || "?");
    if (locked.length) return { error: `Đã trả lương tháng ${month} cho: ${locked.join(", ")} – mở khoá ở Bảng lương trước` };
    const actor = adminActor(admin);
    for (const u of users) {
      const bp = await BonusPenalty.create({ userId: u._id, storeId: u.storeId, kind, date, month, amountVnd, content, attendanceId, createdBy: actor.name });
      await audit(actor, "bonusPenalty.create", { type: "BonusPenalty", id: String(bp._id) }, null, { userId: String(u._id), kind, amountVnd, content, date, batch: users.length > 1 ? users.length : undefined });
    }
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Sửa khoản thưởng/phạt (khi tháng chưa chốt). */
export async function updateBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const bp = await BonusPenalty.findById(str(fd.get("id")));
    if (!bp) return { error: "Không tìm thấy" };
    const date = str(fd.get("date"));
    const amountVnd = Math.round(num(fd.get("amountVnd")));
    const content = str(fd.get("content"));
    if (!DATE_RE.test(date)) return { error: "Ngày không hợp lệ" };
    if (amountVnd <= 0) return { error: "Số tiền phải > 0" };
    if (content.length < 3) return { error: "Nhập nội dung" };
    await assertNotLocked(bp.storeId, bp.month, bp.userId); // tháng cũ
    await assertNotLocked(bp.storeId, date.slice(0, 7), bp.userId); // tháng mới (nếu đổi ngày)
    const before = bp.toObject();
    bp.set({ kind: str(fd.get("kind")) === "BONUS" ? "BONUS" : "PENALTY", date, month: date.slice(0, 7), amountVnd, content });
    await bp.save();
    await audit(adminActor(admin), "bonusPenalty.update", { type: "BonusPenalty", id: String(bp._id) }, before, bp.toObject());
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteBonusPenalty(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const bp = await BonusPenalty.findById(str(fd.get("id")));
    if (!bp) return { error: "Không tìm thấy" };
    await assertNotLocked(bp.storeId, bp.month, bp.userId);
    await audit(adminActor(admin), "bonusPenalty.delete", { type: "BonusPenalty", id: String(bp._id) }, bp.toObject(), null);
    await bp.deleteOne();
    revalidatePath("/admin/bonus-penalty");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Bảng lương (spec 3.7) ===== */
export async function payrollAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("payroll");
    const actor = adminActor(admin);
    const op = str(fd.get("op"));
    const storeId = str(fd.get("storeId"));
    const month = str(fd.get("month"));
    if (op === "generate") {
      const p = await generatePayroll(storeId, month);
      if (p.status === "PAID") return { error: "Bảng lương đã trả – mở khoá (nhập lý do) nếu cần tính lại" };
      await audit(actor, "payroll.generate", { type: "Payroll", id: String(p._id) });
    } else if (op === "publish") {
      const tz = await storeTz(storeId);
      if (month >= localMonth(new Date(), tz)) return { error: "Chỉ công bố được bảng lương của tháng đã kết thúc" };
      const p = await Payroll.findOne({ storeId, month });
      if (!p) return { error: "Chưa có bảng lương" };
      const r = await publishPayroll(p._id, actor.name);
      if (!r) return { error: "Bảng lương không ở trạng thái nháp" };
      await audit(actor, "payroll.publish", { type: "Payroll", id: String(p._id) });
    } else if (op === "paid") {
      // trả hết: tính lại lần cuối → khoá mọi dòng chưa trả + cả bảng
      const p = await Payroll.findOne({ storeId, month });
      if (!p || p.status === "PAID") return { error: "Bảng lương đã trả / chưa có" };
      await generatePayroll(storeId, month);
      const now = new Date();
      await PayrollItem.updateMany({ payrollId: p._id, paidAt: null }, { $set: { paidAt: now, paidBy: actor.name } });
      await Payroll.updateOne({ _id: p._id }, { $set: { status: "PAID", paidAt: now, ...(p.publishedAt ? {} : { publishedAt: now, publishedBy: actor.name }) } });
      await audit(actor, "payroll.paid", { type: "Payroll", id: `${storeId}:${month}` });
    } else if (op === "unlock") {
      // mở khoá cả bảng: bỏ "đã trả" mọi dòng, bảng về "Đã công bố" (nhân viên vẫn xem được), tự tính lại
      const reason = str(fd.get("reason"));
      if (reason.length < 3) return { error: "Nhập lý do mở khoá" };
      const p = await Payroll.findOne({ storeId, month });
      if (!p) return { error: "Chưa có bảng lương" };
      await PayrollItem.updateMany({ payrollId: p._id }, { $unset: { paidAt: 1, paidBy: 1 } });
      await Payroll.updateOne({ _id: p._id }, { $set: { status: "PUBLISHED", unlockedAt: new Date() }, $unset: { paidAt: 1 } });
      await audit(actor, "payroll.unlock", { type: "Payroll", id: `${storeId}:${month}` }, null, { reason });
    } else if (op === "unpublish") {
      // ẩn bảng lương khỏi nhân viên (không tự công bố lại ngày 5)
      const reason = str(fd.get("reason"));
      await Payroll.updateOne({ storeId, month, status: "PUBLISHED" }, { $set: { status: "DRAFT", unlockedAt: new Date() }, $unset: { publishedAt: 1 } });
      await audit(actor, "payroll.unpublish", { type: "Payroll", id: `${storeId}:${month}` }, null, { reason });
    }
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Từng nhân viên: "Đã trả" → khoá dòng lương của người đó; "Mở khoá" (bắt buộc lý do) → tính lại được. */
export async function payrollItemAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("payroll");
    const actor = adminActor(admin);
    const item = await PayrollItem.findById(str(fd.get("itemId")));
    if (!item) return { error: "Không tìm thấy dòng lương" };
    const p = await Payroll.findById(item.payrollId);
    if (!p) return { error: "Không tìm thấy bảng lương" };
    const op = str(fd.get("op"));
    if (op === "paid") {
      if (item.paidAt) return { error: "Đã đánh dấu trả rồi" };
      await generatePayroll(String(p.storeId), p.month); // chốt số mới nhất trước khi khoá
      await PayrollItem.updateOne({ _id: item._id, paidAt: null }, { $set: { paidAt: new Date(), paidBy: actor.name } });
      // trả đủ mọi người → cả bảng "Đã trả"
      if (!(await PayrollItem.exists({ payrollId: p._id, paidAt: null })))
        await Payroll.updateOne({ _id: p._id }, { $set: { status: "PAID", paidAt: new Date(), ...(p.publishedAt ? {} : { publishedAt: new Date(), publishedBy: actor.name }) } });
      await audit(actor, "payroll.item.paid", { type: "PayrollItem", id: String(item._id) }, null, { userId: String(item.userId), month: p.month, netPay: item.netPay });
    } else if (op === "unpaid") {
      const reason = str(fd.get("reason"));
      if (reason.length < 3) return { error: "Nhập lý do mở khoá" };
      await PayrollItem.updateOne({ _id: item._id }, { $unset: { paidAt: 1, paidBy: 1 } });
      if (p.status === "PAID") await Payroll.updateOne({ _id: p._id }, { $set: { status: "PUBLISHED", unlockedAt: new Date() }, $unset: { paidAt: 1 } });
      await generatePayroll(String(p.storeId), p.month);
      await audit(actor, "payroll.item.unlock", { type: "PayrollItem", id: String(item._id) }, null, { userId: String(item.userId), month: p.month, reason });
    } else return { error: "Thao tác không hợp lệ" };
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function savePayrollExtras(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("payroll");
    const itemId = str(fd.get("itemId"));
    await updateItemExtras(itemId, num(fd.get("allowance")), num(fd.get("advance")));
    await audit(adminActor(admin), "payroll.item.extras", { type: "PayrollItem", id: itemId }, null, { allowance: num(fd.get("allowance")), advance: num(fd.get("advance")) });
    revalidatePath("/admin/payroll");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Yêu cầu điều chỉnh & phản hồi lương ===== */
export async function resolveAdjustment(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("adjustments"); // mặc định chỉ Admin Tổng; admin cần được cấp quyền
    // GIỮ yêu cầu trước (nguyên tử): bấm đúp / 2 admin cùng bấm → chỉ 1 người xử lý, người sau nhận "đã được xử lý"
    // (khoá quá 2 phút coi như bị treo – cho xử lý lại)
    const req = await AdjustmentRequest.findOneAndUpdate(
      { _id: str(fd.get("id")), status: "PENDING", $or: [{ lockedAt: null }, { lockedAt: { $lt: new Date(Date.now() - 2 * 60_000) } }] },
      { $set: { lockedAt: new Date() } },
      { returnDocument: "after" },
    );
    if (!req) return { error: "Yêu cầu đã được xử lý (hoặc đang được admin khác duyệt)" };
    const op = str(fd.get("op"));
    const reply = str(fd.get("reply"));
    try {
      if (op === "approve") {
        let target = req.attendanceId ? await Attendance.findById(req.attendanceId).lean() : null;
        // chỉ sửa lượt của CHÍNH người gửi yêu cầu
        if (target && String(target.userId) !== String(req.userId)) target = null;
        if (!target && req.workDate) {
          // lượt cùng ngày đang thiếu giờ ra
          target = await Attendance.findOne({ userId: req.userId, workDate: req.workDate, status: { $in: ["OPEN", "MISSING_CHECKOUT"] } }).lean();
        }
        await upsertAttendance(admin, {
          id: target ? String(target._id) : undefined,
          userId: String(req.userId),
          date: req.workDate || (target?.workDate ?? ""),
          inTime: str(fd.get("inTime")) || req.checkInTime || "",
          outTime: str(fd.get("outTime")) || req.checkOutTime || "",
          reason: `Yêu cầu NV: ${req.reason}`,
          source: "REQUEST",
        });
        req.status = "APPROVED";
      } else {
        req.status = "REJECTED";
      }
    } catch (e) {
      // ghi lỗi → nhả khoá để duyệt lại được
      await AdjustmentRequest.updateOne({ _id: req._id }, { $unset: { lockedAt: 1 } });
      throw e;
    }
    req.adminName = adminActor(admin).name;
    req.adminReply = reply;
    req.resolvedAt = new Date();
    req.set("lockedAt", undefined);
    await req.save();
    await audit(adminActor(admin), op === "approve" ? "adjustment.approve" : "adjustment.reject", { type: "AdjustmentRequest", id: String(req._id) }, null, {
      userId: String(req.userId),
      date: req.workDate,
      reply,
    });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function replyFeedback(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const reply = str(fd.get("reply"));
    if (reply.length < 2) return { error: "Nhập nội dung phản hồi" };
    const fb = await PayrollFeedback.findOneAndUpdate({ _id: str(fd.get("id")) }, { $set: { adminReply: reply, adminName: adminActor(admin).name, status: "RESOLVED" } }).lean();
    if (fb) await audit(adminActor(admin), "feedback.reply", { type: "PayrollFeedback", id: String(fb._id) }, null, { userId: String(fb.userId), month: fb.month, reply });
    revalidatePath("/admin/requests");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Xoá hàng loạt lượt chấm công đã tích (bảng chấm công của 1 nhân viên). Tháng đã chốt lương → bỏ qua lượt đó. */
export async function bulkDeleteAttendance(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    const ids = [...new Set(fd.getAll("ids").map(String))].filter((x) => Types.ObjectId.isValid(x));
    if (!ids.length) return { error: "Chưa tích lượt nào" };
    if (ids.length > 300) return { error: "Tối đa 300 lượt mỗi lần" };
    const reason = str(fd.get("reason")) || "Xoá hàng loạt";
    const list = await Attendance.find({ _id: { $in: ids } });
    let done = 0;
    const lockedMonths = new Set<string>();
    for (const a of list) {
      try {
        await assertNotLocked(payStoreOf(a), a.month, a.userId);
      } catch {
        lockedMonths.add(a.month);
        continue;
      }
      await AttendanceAdjustment.create({ attendanceId: a._id, adminName: actor.name, action: "DELETE", before: a.toObject(), reason });
      await a.deleteOne();
      done++;
    }
    await audit(actor, "attendance.bulkDelete", { type: "Attendance" }, null, { n: done, userIds: [...new Set(list.map((a) => String(a.userId)))], reason });
    revalidatePath("/admin/attendance", "layout");
    revalidatePath("/admin/work-schedule");
    if (lockedMonths.size) return { error: `Đã xoá ${done} lượt. Bỏ qua lượt thuộc tháng đã chốt lương: ${[...lockedMonths].join(", ")}` };
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}


