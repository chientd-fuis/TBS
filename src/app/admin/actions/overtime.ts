"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Attendance } from "@/lib/models";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { assertNotLocked, payStoreOf, storeTz } from "@/lib/attendance";
import { durVi, rejectOvertimeHours } from "@/lib/overtime";
import { localTime } from "@/lib/time";
import { errMsg, str, type FormState } from "./types";

/**
 * Làm thêm giờ chờ xác nhận: Duyệt = giữ giờ công (xoá khỏi danh sách chờ);
 * Từ chối = giờ ra = giờ hết ca, chỉ tính công trong ca (bỏ giờ làm thêm). Quyền: duyệt chấm công (adjustments).
 */
export async function resolveOvertime(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("adjustments");
    await connectDB();
    const a = await Attendance.findById(str(fd.get("id"))).lean();
    if (!a?.overtime || a.overtime.status !== "PENDING") return { error: "Yêu cầu không còn chờ xác nhận" };
    await assertNotLocked(payStoreOf(a), a.month, a.userId);
    const actor = adminActor(admin);
    const reply = str(fd.get("reply")).slice(0, 200);
    const tz = await storeTz(a.storeId);
    const hm = (d: Date) => localTime(d, tz).slice(0, 5);
    const approve = str(fd.get("op")) !== "reject";
    if (approve) {
      await Attendance.updateOne(
        { _id: a._id, "overtime.status": "PENDING" },
        {
          $set: {
            "overtime.status": "APPROVED",
            "overtime.decidedBy": actor.name,
            "overtime.decidedAt": new Date(),
            "overtime.reply": reply,
            staffNote: `Admin đã duyệt làm thêm ${durVi(a.overtime.minutes ?? 0)}${reply ? ` – ${reply}` : ""}.`,
          },
        },
      );
    } else {
      const { fields, cap, actualOutAt } = await rejectOvertimeHours(a);
      await Attendance.updateOne(
        { _id: a._id, "overtime.status": "PENDING" },
        {
          $set: {
            ...fields,
            checkOutAt: cap,
            earlyMinutes: 0,
            "overtime.status": "REJECTED",
            "overtime.actualOutAt": actualOutAt,
            "overtime.decidedBy": actor.name,
            "overtime.decidedAt": new Date(),
            "overtime.reply": reply,
            note: [a.note, `Không duyệt làm thêm (ra thật ${hm(actualOutAt)}) – tính công tới ${hm(cap)}`].filter(Boolean).join(" | "),
            staffNote: `Admin không duyệt làm thêm – chỉ tính công tới giờ hết ca ${hm(cap)}${reply ? ` (${reply})` : ""}.`,
          },
        },
      );
    }
    await audit(actor, approve ? "attendance.overtime.approve" : "attendance.overtime.reject", { type: "Attendance", id: String(a._id) }, null, {
      userId: String(a.userId),
      minutes: a.overtime.minutes,
      reply,
    });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
