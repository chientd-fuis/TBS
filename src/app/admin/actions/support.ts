"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Attendance } from "@/lib/models";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { assertNotLocked, computeFields, payStoreOf } from "@/lib/attendance";
import { errMsg, str, type FormState } from "./types";

/**
 * Hỗ trợ cơ sở chưa xếp ca (nhân viên tự check-in ở cơ sở khác cơ sở gốc): Duyệt = giữ nguyên giờ công;
 * Từ chối = lượt này 0 giờ (payFactor = 0 → mọi lần tính lại giờ công vẫn giữ 0). Quyền: duyệt chấm công (adjustments).
 */
export async function resolveSupport(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("adjustments");
    await connectDB();
    const a = await Attendance.findById(str(fd.get("id"))).lean();
    if (a?.support?.status !== "PENDING") return { error: "Yêu cầu không còn chờ duyệt" };
    await assertNotLocked(payStoreOf(a), a.month, a.userId);
    const actor = adminActor(admin);
    const reply = str(fd.get("reply")).slice(0, 200);
    const approve = str(fd.get("op")) !== "reject";
    const decided = { "support.decidedBy": actor.name, "support.decidedAt": new Date(), "support.reply": reply };
    if (approve) {
      await Attendance.updateOne({ _id: a._id, "support.status": "PENDING" }, { $set: { "support.status": "APPROVED", ...decided } });
    } else {
      // đã check-out → tính lại ngay; đang trong ca → check-out sau sẽ tự ra 0 giờ (payFactor = 0)
      const fields = a.checkOutAt
        ? await computeFields({ storeId: a.storeId, shiftAssignmentId: a.shiftAssignmentId, checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, extraHours: a.extraHours, payFactor: 0 })
        : {};
      await Attendance.updateOne(
        { _id: a._id, "support.status": "PENDING" },
        {
          $set: {
            ...(a.checkOutAt ? { roundedHours: fields.roundedHours } : {}),
            payFactor: 0,
            "support.status": "REJECTED",
            ...decided,
            staffNote: `Admin không duyệt hỗ trợ cơ sở (chưa được xếp ca) – lượt này không tính công${reply ? ` (${reply})` : ""}.`,
          },
        },
      );
    }
    await audit(actor, approve ? "attendance.support.approve" : "attendance.support.reject", { type: "Attendance", id: String(a._id) }, null, {
      userId: String(a.userId),
      storeId: String(a.storeId),
      reply,
    });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
