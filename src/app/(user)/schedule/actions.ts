"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { ShiftAssignment, ShiftRegRequest, ShiftTemplate, Store } from "@/lib/models";
import { addDays, localDate, weekDays, weekStartOf, isYmd } from "@/lib/time";

export type RegResult = { ok?: boolean; error?: string; message?: string };

/**
 * Nhân viên đăng ký ca cho 1 tuần TƯƠNG LAI (từ tuần sau trở đi) – spec 4.7.
 * keys: danh sách "YYYY-MM-DD|shiftTemplateId" muốn làm.
 * - Ca mới → PENDING (chờ admin duyệt)
 * - Bỏ chọn ca đang chờ → xoá đăng ký
 * - Ca đã duyệt không tự bỏ được (liên hệ admin)
 */
export async function saveShiftRequests(weekStart: string, keys: string[]): Promise<RegResult> {
  const user = await requireActiveUser();
  try {
    const store = await Store.findById(user.storeId).lean();
    if (!store) return { error: "Bạn chưa thuộc cơ sở nào" };
    const tz = store.timezone || "Asia/Ho_Chi_Minh";
    if (!isYmd(weekStart) || weekStartOf(weekStart) !== weekStart) return { error: "Tuần không hợp lệ" };
    const nextWeek = addDays(weekStartOf(localDate(new Date(), tz)), 7);
    if (weekStart < nextWeek) return { error: "Chỉ đăng ký được ca cho tuần sau trở đi" };
    if (weekStart > addDays(nextWeek, 7 * 8)) return { error: "Chỉ đăng ký trước tối đa 8 tuần" };

    const days = weekDays(weekStart);
    const tpls = await ShiftTemplate.find({ storeId: store._id, active: true }).lean();
    const tplMap = new Map(tpls.map((t) => [String(t._id), t]));
    const wanted = new Set(
      keys.filter((k) => {
        const [d, t] = k.split("|");
        return days.includes(d) && tplMap.has(t);
      }),
    );

    // chỉ đăng ký của cơ sở gốc (không đụng ca hỗ trợ cơ sở khác do admin xếp)
    const existing = await ShiftAssignment.find({ userId: user._id, storeId: store._id, date: { $gte: days[0], $lte: days[6] } }).lean();
    let added = 0;
    let removed = 0;
    for (const e of existing) {
      const k = `${e.date}|${e.shiftTemplateId}`;
      if (!wanted.has(k) && e.status === "PENDING") {
        await ShiftAssignment.deleteOne({ _id: e._id, status: "PENDING" });
        removed++;
      }
    }
    for (const k of wanted) {
      const [date, tplId] = k.split("|");
      const e = existing.find((x) => x.date === date && String(x.shiftTemplateId) === tplId);
      if (e && e.status !== "REJECTED") continue; // đã có (chờ / đã duyệt)
      const t = tplMap.get(tplId)!;
      await ShiftAssignment.updateOne(
        { userId: user._id, date, shiftTemplateId: tplId },
        {
          $set: { storeId: store._id, startTime: t.startTime, endTime: t.endTime, shiftName: t.name, status: "PENDING", source: "REQUEST" },
          $unset: { decidedBy: 1, decidedAt: 1 },
        },
        { upsert: true },
      );
      added++;
    }
    // có đăng ký ca trong tuần → hoàn tất yêu cầu đăng ký của admin (nếu có)
    if (wanted.size > 0)
      await ShiftRegRequest.updateOne({ userId: user._id, weekStart, status: "OPEN" }, { $set: { status: "DONE", respondedAt: new Date() } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Đã gửi đăng ký: thêm ${added}, bỏ ${removed} ca. Chờ admin duyệt.` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Nhân viên báo nghỉ cả tuần → đóng yêu cầu đăng ký ca của admin. */
export async function declareWeekOff(weekStart: string): Promise<RegResult> {
  const user = await requireActiveUser();
  try {
    const r = await ShiftRegRequest.updateOne({ userId: user._id, weekStart, status: "OPEN" }, { $set: { status: "OFF", respondedAt: new Date() } });
    if (!r.modifiedCount) return { error: "Không có yêu cầu đăng ký nào cho tuần này" };
    revalidatePath("/", "layout");
    return { ok: true, message: "Đã báo admin: bạn nghỉ tuần này" };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
