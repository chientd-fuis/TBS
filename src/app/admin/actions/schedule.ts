"use server";
import { revalidatePath } from "next/cache";
import { ShiftAssignment, ShiftTemplate, User } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { isYmd, weekStartOf } from "@/lib/time";
import { planAutoSchedule, slotInterval, type AutoOptions, type PlanChange } from "@/lib/schedule";
import { loadHistory, loadWeek } from "@/lib/schedule-data";

/* Xếp ca theo tuần (spec 3.2.1): duyệt đăng ký, xếp tay, xếp tự động. Gọi trực tiếp từ client. */

export type Result = { ok?: boolean; error?: string; message?: string };
const path = (storeId: string) => `/admin/schedule/${storeId}`;
const fail = (e: unknown): Result => ({ error: (e as Error).message || "Lỗi hệ thống" });

/** Duyệt / từ chối đăng ký ca (từng ca, từng người, hoặc tất cả – client gửi danh sách id). */
export async function decideShifts(storeId: string, ids: string[], decision: "APPROVED" | "REJECTED"): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    if (!ids.length) return { error: "Không có đăng ký nào" };
    const r = await ShiftAssignment.updateMany(
      { _id: { $in: ids }, storeId, status: "PENDING" },
      { $set: { status: decision, decidedBy: actor.name, decidedAt: new Date() } },
    );
    await audit(actor, decision === "APPROVED" ? "schedule.approve" : "schedule.reject", { type: "Store", id: storeId }, null, { ids, n: r.modifiedCount });
    revalidatePath(path(storeId));
    return { ok: true, message: `${decision === "APPROVED" ? "Đã duyệt" : "Đã từ chối"} ${r.modifiedCount} ca` };
  } catch (e) {
    return fail(e);
  }
}

/** Xếp tay: thêm nhân viên vào 1 ô (ca × ngày). Nếu nhân viên đã đăng ký ô đó → duyệt luôn. */
export async function addToSlot(storeId: string, tplId: string, date: string, userId: string): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    if (!isYmd(date)) return { error: "Ngày không hợp lệ" };
    const tpl = await ShiftTemplate.findOne({ _id: tplId, storeId }).lean();
    if (!tpl) return { error: "Ca không thuộc cơ sở này" };
    const user = await User.findOne({ _id: userId, status: "ACTIVE" }).select("name").lean();
    if (!user) return { error: "Nhân viên không hợp lệ" };
    // cảnh báo trùng giờ với ca khác đã duyệt cùng ngày / ngày trước (ca qua đêm)
    const week = await loadWeek(storeId, weekStartOf(date));
    const t = week.templates.find((x) => x.id === tplId);
    if (t) {
      const [s, e] = slotInterval(week.days, date, t);
      const clash = week.entries.some((x) => {
        if (x.userId !== userId || x.status !== "APPROVED" || (x.tplId === tplId && x.date === date)) return false;
        const o = week.templates.find((y) => y.id === x.tplId);
        if (!o) return false;
        const [a, b] = slotInterval(week.days, x.date, o);
        return s < b && a < e;
      });
      if (clash) return { error: `${user.name} đã có ca khác trùng giờ` };
    }
    await ShiftAssignment.updateOne(
      { userId, date, shiftTemplateId: tplId },
      {
        $set: { storeId, startTime: tpl.startTime, endTime: tpl.endTime, shiftName: tpl.name, status: "APPROVED", decidedBy: actor.name, decidedAt: new Date() },
        $setOnInsert: { source: "MANUAL" },
      },
      { upsert: true },
    );
    await audit(actor, "schedule.add", { type: "ShiftTemplate", id: tplId }, null, { userId, date });
    revalidatePath(path(storeId));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFromSlot(storeId: string, id: string): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const a = await ShiftAssignment.findOneAndDelete({ _id: id, storeId }).lean();
    if (!a) return { error: "Không tìm thấy" };
    await audit(adminActor(admin), "schedule.remove", { type: "ShiftAssignment", id }, a, null);
    revalidatePath(path(storeId));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Định mức người theo ca: tối thiểu (thiếu người) & định mức (ít người). */
export async function saveStaffing(storeId: string, tplId: string, minStaff: number, targetStaff: number): Promise<Result> {
  try {
    const admin = await assertAdmin();
    const min = Math.max(0, Math.floor(minStaff || 0));
    const target = Math.max(min, Math.floor(targetStaff || 0));
    await ShiftTemplate.updateOne({ _id: tplId, storeId }, { $set: { minStaff: min, targetStaff: target } });
    await audit(adminActor(admin), "schedule.staffing", { type: "ShiftTemplate", id: tplId }, null, { min, target });
    revalidatePath(path(storeId));
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
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    if (!isYmd(weekStart) || weekStartOf(weekStart) !== weekStart) return { error: "Tuần không hợp lệ" };
    const week = await loadWeek(storeId, weekStart);
    const history = await loadHistory(storeId, weekStart);
    const plan = planAutoSchedule({ days: week.days, templates: week.templates, staff: week.staff, entries: week.entries, history, opts });
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
    revalidatePath(path(storeId));
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
