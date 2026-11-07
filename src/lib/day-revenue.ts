import { Types } from "mongoose";
import { connectDB } from "./db";
import { DayRevenue, ShiftClosing, ShiftTemplate, Store } from "./models";
import { REVENUE_KEYS, sumRevenue, type Revenue } from "./revenue";
import { sheetsConfigured, writeDayRow } from "./sheets";
import { DEFAULT_TZ, localDate } from "./time";

type Id = string | Types.ObjectId;

/** Ca đang chốt có phải ca cuối ngày của cơ sở không (ca mẫu đang dùng có giờ bắt đầu muộn nhất). */
export async function isDayEndShift(storeId: Id, shiftStart?: string | null) {
  if (!shiftStart) return false;
  const last = await ShiftTemplate.findOne({ storeId, active: true }).sort({ startTime: -1 }).select("startTime").lean();
  return !!last && shiftStart >= last.startTime;
}

/** Cộng lại doanh thu 1 ngày từ các lượt chốt ca. Số thay đổi so với lần đã ghi sheet → chờ ghi lại. */
export async function recomputeDay(storeId: Id, date: string) {
  await connectDB();
  const list = await ShiftClosing.find({ storeId, workDate: date, "revenue.dt": { $ne: null } })
    .sort({ createdAt: 1 })
    .select("revenue revenueInput note shiftName employeeName")
    .lean();
  const total = sumRevenue(list.map((c) => (c.revenue ?? {}) as Partial<Revenue>));
  // Ghi chú ngày (cột J): chi tiết thu chi (nếu có mô tả) + ghi chú của từng ca
  const note = [
    ...list
      .map((c) => {
        const who = c.shiftName ? `Ca ${c.shiftName}` : c.employeeName;
        const tc = c.revenueInput?.cp && /[a-zA-ZÀ-ỹ]/.test(c.revenueInput.cp) ? `TC: ${c.revenueInput.cp}` : "";
        const parts = [tc, c.note].filter(Boolean);
        return parts.length ? `${who}: ${parts.join("; ")}` : "";
      })
      .filter(Boolean),
  ]
    .join(" | ")
    .slice(0, 500);
  const prev = await DayRevenue.findOne({ storeId, date }).lean();
  const changed = !prev || REVENUE_KEYS.some((k) => (prev[k] ?? 0) !== total[k]) || (prev.note ?? "") !== note;
  const day = await DayRevenue.findOneAndUpdate(
    { storeId, date },
    {
      $set: {
        month: date.slice(0, 7),
        ...total,
        closings: list.length,
        note,
        ...(changed && prev?.sheet?.status === "SENT" ? { "sheet.status": "PENDING" } : {}),
      },
      $setOnInsert: { "sheet.status": "PENDING" },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return { day: day!, wasSynced: prev?.sheet?.status === "SENT", changed };
}

function friendly(e: unknown) {
  const msg = (e as { message?: string }).message ?? String(e);
  if (/DECODER routines|unsupported|PEM|private key|invalid_grant/i.test(msg))
    return "Private key của service account sai định dạng – dán lại theo hướng dẫn (nên dùng GOOGLE_SA_JSON)";
  if (/does not have permission|PERMISSION_DENIED|403/i.test(msg)) return "Service account chưa được share quyền chỉnh sửa file sheet";
  if (/Unable to parse range/i.test(msg)) return "Không có tab tháng này trong sheet (VD tab T11) – hãy tạo tab theo mẫu";
  if (/Requested entity was not found|404/i.test(msg)) return "Không tìm thấy file Google Sheet – kiểm tra link";
  return msg.slice(0, 300);
}

/** Ghi 1 ngày lên Google Sheet của cơ sở. */
export async function syncDaySheet(storeId: Id, date: string) {
  await connectDB();
  const [store, day] = await Promise.all([Store.findById(storeId).lean(), DayRevenue.findOne({ storeId, date })]);
  if (!store || !day) return "FAILED" as const;
  if (!store.revenueSheetId || !sheetsConfigured()) {
    day.set("sheet", {
      ...day.toObject().sheet,
      status: "DISABLED",
      error: !sheetsConfigured() ? "Chưa cấu hình service account Google" : "Cơ sở chưa gắn Google Sheet doanh thu",
    });
    await day.save();
    return "DISABLED" as const;
  }
  try {
    const range = await writeDayRow(store, date, { dt: day.dt, tm: day.tm, tk: day.tk, cp: day.cp, grab: day.grab ?? 0, shopee: day.shopee }, day.note ?? "");
    day.set("sheet", { status: "SENT", error: "", range, attempts: (day.sheet?.attempts ?? 0) + 1, syncedAt: new Date() });
  } catch (e) {
    day.set("sheet", { ...day.toObject().sheet, status: "FAILED", error: friendly(e), attempts: (day.sheet?.attempts ?? 0) + 1 });
  }
  await day.save();
  return day.sheet!.status as "SENT" | "FAILED";
}

/** Sau mỗi lượt chốt ca: cộng lại ngày; ghi sheet nếu là ca cuối ngày, hoặc ngày đã ghi trước đó (cập nhật số mới). */
export async function afterClosing(storeId: Id, date: string, isDayEnd: boolean) {
  const { wasSynced, changed } = await recomputeDay(storeId, date);
  if (isDayEnd || (wasSynced && changed)) return syncDaySheet(storeId, date);
  return null;
}

/** Cron: ghi các ngày đã qua mà chưa ghi được (ca tối quên chốt, lỗi mạng…). */
export async function syncPendingDays(limit = 30) {
  await connectDB();
  const today = localDate(new Date(), DEFAULT_TZ);
  const list = await DayRevenue.find({
    date: { $lt: today },
    "sheet.status": { $in: ["PENDING", "FAILED"] },
    "sheet.attempts": { $not: { $gte: 10 } },
  })
    .sort({ date: 1 })
    .limit(limit)
    .select("storeId date")
    .lean();
  let ok = 0;
  for (const d of list) if ((await syncDaySheet(d.storeId, d.date)) === "SENT") ok++;
  return ok;
}
