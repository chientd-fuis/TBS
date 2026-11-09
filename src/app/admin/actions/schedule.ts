"use server";
import { Types } from "mongoose";
import { revalidatePath } from "next/cache";
import { ShiftAssignment, ShiftRegRequest, ShiftTemplate, Store, User } from "@/lib/models";
import { adminOrStaff } from "@/lib/staff-guard";
import { audit } from "@/lib/audit";
import { addDays, isYmd, localDate, weekStartOf } from "@/lib/time";
import { planAutoSchedule, type AutoOptions, type PlanChange } from "@/lib/schedule";
import { loadHistory, loadWeek } from "@/lib/schedule-data";
import { findShiftClash, findShiftClashes } from "@/lib/support";
import { notifyUser } from "@/lib/cover";

/* Xếp ca theo tuần (spec 3.2.1): duyệt đăng ký, xếp tay, xếp tự động. Gọi trực tiếp từ client. */

/** clash: nhân viên đã có ca trùng giờ (ở cơ sở khác / cơ sở này) → giao diện hỏi "Vẫn yêu cầu hỗ trợ" (gọi lại với force) */
export type Result = { ok?: boolean; error?: string; message?: string; clash?: string };
const path = (storeId: string) => `/admin/schedule/${storeId}`;
/** revalidate cả trang admin lẫn trang Quản lý của nhân viên */
const revalidate = (storeId: string) => {
  revalidatePath(path(storeId));
  revalidatePath(`/manage/schedule/${storeId}`);
};
const fail = (e: unknown): Result => ({ error: (e as Error).message || "Lỗi hệ thống" });

/** Duyệt / từ chối đăng ký ca (từng ca, từng người, hoặc tất cả – client gửi danh sách id). */
export async function decideShifts(storeId: string, ids: string[], decision: "APPROVED" | "REJECTED"): Promise<Result> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    const list = (Array.isArray(ids) ? ids : []).map(String).filter((x) => Types.ObjectId.isValid(x));
    if (!list.length) return { error: "Không có đăng ký nào" };
    const meta = { decidedBy: actor.name, decidedAt: new Date() };
    if (decision !== "APPROVED") {
      const r = await ShiftAssignment.updateMany({ _id: { $in: list }, storeId, status: "PENDING" }, { $set: { status: "REJECTED", ...meta } });
      await audit(actor, "schedule.reject", { type: "Store", id: storeId }, null, { ids: list, n: r.modifiedCount });
      revalidate(storeId);
      return { ok: true, message: `Đã từ chối ${r.modifiedCount} ca` };
    }
    // duyệt từng ca theo giờ: ca trùng giờ với ca đã duyệt (ở đây / cơ sở khác / vừa duyệt trong lượt này) → bỏ qua, báo lại
    const pend = await ShiftAssignment.find({ _id: { $in: list }, storeId, status: "PENDING" }).sort({ date: 1, startTime: 1 }).lean();
    const names = new Map((await User.find({ _id: { $in: pend.map((p) => p.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
    let n = 0;
    const skipped: string[] = [];
    for (const p of pend) {
      const clash = p.startTime && p.endTime ? await findShiftClash(p.userId, p.date, p.startTime, p.endTime, { tplId: String(p.shiftTemplateId), date: p.date }) : null;
      if (clash) {
        skipped.push(`${names.get(String(p.userId)) ?? "?"} ${p.date.slice(8)}/${p.date.slice(5, 7)} ${p.shiftName ?? ""} (trùng ${clash})`);
        continue;
      }
      const r = await ShiftAssignment.updateOne({ _id: p._id, status: "PENDING" }, { $set: { status: "APPROVED", ...meta } });
      n += r.modifiedCount;
    }
    await audit(actor, "schedule.approve", { type: "Store", id: storeId }, null, { ids: list, n, skipped: skipped.length });
    revalidate(storeId);
    if (skipped.length) return { ok: true, message: `Đã duyệt ${n} ca. ⚠ Bỏ qua ${skipped.length} ca trùng giờ: ${skipped.slice(0, 5).join("; ")}${skipped.length > 5 ? "…" : ""}` };
    return { ok: true, message: `Đã duyệt ${n} ca` };
  } catch (e) {
    return fail(e);
  }
}

/** Xếp tay: thêm nhân viên vào 1 ô (ca × ngày). Nếu nhân viên đã đăng ký ô đó → duyệt luôn. */
export async function addToSlot(storeId: string, tplId: string, date: string, userId: string, force = false): Promise<Result> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    if (!isYmd(date)) return { error: "Ngày không hợp lệ" };
    const tpl = await ShiftTemplate.findOne({ _id: tplId, storeId }).lean();
    if (!tpl) return { error: "Ca không thuộc cơ sở này" };
    const user = await User.findOne({ _id: userId, status: "ACTIVE" }).select("name storeId").lean();
    if (!user) return { error: "Nhân viên không hợp lệ" };
    // đã có ca xếp / duyệt trùng giờ (ở cơ sở này hoặc cơ sở khác) → hỏi lại; "Vẫn yêu cầu hỗ trợ" (force) = xoá ca đó rồi xếp vào đây
    const clashes = await findShiftClashes(String(userId), date, tpl.startTime, tpl.endTime, { tplId: String(tplId), date });
    if (clashes.length && !force)
      return { error: `${user.name} đã có ca trùng giờ`, clash: `${user.name} đã được xếp: ${clashes.map((c) => c.text).join("; ")}` };
    if (clashes.length) {
      // nhân viên quản lý chỉ được bỏ ca ở cơ sở mình quản lý
      if (actor.kind === "USER") for (const c of clashes) await adminOrStaff("schedule", c.storeId);
      const removed = await ShiftAssignment.find({ _id: { $in: clashes.map((c) => c.id) } }).lean();
      await ShiftAssignment.deleteMany({ _id: { $in: clashes.map((c) => c.id) } });
      for (const a of removed) {
        await audit(actor, "schedule.remove", { type: "ShiftAssignment", id: String(a._id) }, a, { reason: "Chuyển sang hỗ trợ cơ sở khác", toStoreId: storeId });
        revalidate(String(a.storeId));
      }
      await notifyUser(
        userId,
        `Lịch của bạn đã đổi: bỏ ${clashes.map((c) => c.text).join("; ")} – chuyển sang làm ca ${tpl.name} ${tpl.startTime}–${tpl.endTime} ngày ${date.slice(8)}/${date.slice(5, 7)} (hỗ trợ cơ sở khác).`,
        "orange",
        "/schedule",
      ).catch(() => null);
    }
    await ShiftAssignment.updateOne(
      { userId, date, shiftTemplateId: tplId },
      {
        $set: { storeId, startTime: tpl.startTime, endTime: tpl.endTime, shiftName: tpl.name, status: "APPROVED", decidedBy: actor.name, decidedAt: new Date() },
        $setOnInsert: { source: "MANUAL" },
      },
      { upsert: true },
    );
    await audit(actor, "schedule.add", { type: "ShiftTemplate", id: tplId }, null, {
      userId,
      date,
      ...(String(user.storeId) !== storeId ? { support: true, fromStoreId: String(user.storeId) } : {}),
    });
    revalidate(storeId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFromSlot(storeId: string, id: string): Promise<Result> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    const a = await ShiftAssignment.findOneAndDelete({ _id: id, storeId }).lean();
    if (!a) return { error: "Không tìm thấy" };
    await audit(actor, "schedule.remove", { type: "ShiftAssignment", id }, a, null);
    revalidate(storeId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Định mức người theo ca: tối thiểu (thiếu người) & định mức (ít người). */
export async function saveStaffing(storeId: string, tplId: string, minStaff: number, targetStaff: number): Promise<Result> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    const min = Math.max(0, Math.floor(minStaff || 0));
    const target = Math.max(min, Math.floor(targetStaff || 0));
    await ShiftTemplate.updateOne({ _id: tplId, storeId }, { $set: { minStaff: min, targetStaff: target } });
    await audit(actor, "schedule.staffing", { type: "ShiftTemplate", id: tplId }, null, { min, target });
    revalidate(storeId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export type PlanView = {
  changes: (PlanChange & { userName: string; tplName: string })[];
  shortages: { date: string; tplName: string; count: number; min: number; target: number; level: string }[];
};

/** Xếp ca tự động: apply=false → xem trước; apply=true → lưu. */
export async function autoSchedule(storeId: string, weekStart: string, opts: AutoOptions, apply: boolean): Promise<Result & { plan?: PlanView }> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    if (!isYmd(weekStart) || weekStartOf(weekStart) !== weekStart) return { error: "Tuần không hợp lệ" };
    const week = await loadWeek(storeId, weekStart);
    const history = await loadHistory(storeId, weekStart);
    const plan = planAutoSchedule({ days: week.days, templates: week.templates, staff: week.staff, entries: week.entries, history, opts, external: week.external });
    const tplName = (id: string) => week.templates.find((t) => t.id === id)?.name ?? "?";
    const view: PlanView = {
      changes: plan.changes.map((c) => ({ ...c, userName: week.names[c.userId] ?? "?", tplName: tplName(c.tplId) })),
      shortages: plan.slots.filter((s) => s.level !== "ok").map((s) => ({ ...s, tplName: tplName(s.tplId) })),
    };
    if (!apply) return { ok: true, plan: view };

    let approved = 0;
    let added = 0;
    for (const c of plan.changes) {
      if (c.kind === "approve") {
        const r = await ShiftAssignment.updateOne(
          { _id: c.entryId, status: "PENDING" },
          { $set: { status: "APPROVED", decidedBy: `${actor.name} (tự động)`, decidedAt: new Date() } },
        );
        approved += r.modifiedCount;
      } else {
        const tpl = week.templates.find((t) => t.id === c.tplId)!;
        const r = await ShiftAssignment.updateOne(
          { userId: c.userId, date: c.date, shiftTemplateId: c.tplId },
          {
            $setOnInsert: { storeId, startTime: tpl.startTime, endTime: tpl.endTime, shiftName: tpl.name, status: "APPROVED", source: "AUTO", decidedBy: `${actor.name} (tự động)`, decidedAt: new Date() },
          },
          { upsert: true },
        );
        added += r.upsertedCount;
      }
    }
    await audit(actor, "schedule.auto", { type: "Store", id: storeId }, null, { weekStart, opts, approved, added });
    revalidate(storeId);
    const short = view.shortages.filter((s) => s.level === "short").length;
    return {
      ok: true,
      plan: view,
      message: `Đã duyệt ${approved} đăng ký, tự xếp thêm ${added} ca.${short ? ` Còn ${short} ca thiếu người (không đủ nhân viên phù hợp).` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** Yêu cầu nhân viên đăng ký ca cho 1 tuần (tuần sau trở đi) – nhân viên thấy cảnh báo + nút Đăng ký ca. */
export async function requestRegistration(storeId: string, weekStart: string, userIds: string[]): Promise<Result> {
  try {
    const { actor } = await adminOrStaff("schedule", storeId);
    if (!isYmd(weekStart) || weekStartOf(weekStart) !== weekStart) return { error: "Tuần không hợp lệ" };
    const store = await Store.findById(storeId).select("timezone").lean();
    if (!store) return { error: "Không tìm thấy cơ sở" };
    const nextWeek = addDays(weekStartOf(localDate(new Date(), store.timezone || "Asia/Ho_Chi_Minh")), 7);
    if (weekStart < nextWeek) return { error: "Nhân viên chỉ đăng ký được ca từ tuần sau trở đi – hãy chuyển sang tuần sau để gửi yêu cầu" };
    // chỉ nhân viên đang làm của chính cơ sở này
    const users = await User.find({ _id: { $in: userIds }, storeId, status: "ACTIVE" }).select("_id").lean();
    if (!users.length) return { error: "Không có nhân viên hợp lệ" };
    for (const u of users)
      await ShiftRegRequest.updateOne(
        { userId: u._id, weekStart },
        { $set: { storeId, status: "OPEN", requestedBy: actor.name, requestedAt: new Date() }, $unset: { respondedAt: 1 } },
        { upsert: true },
      );
    await audit(actor, "schedule.requestRegistration", { type: "Store", id: storeId }, null, { weekStart, userIds: users.map((u) => String(u._id)) });
    revalidate(storeId);
    return { ok: true, message: `Đã gửi yêu cầu đăng ký ca cho ${users.length} nhân viên` };
  } catch (e) {
    return fail(e);
  }
}
