"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Attendance } from "@/lib/models";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { assertNotLocked, payStoreOf, storeTz } from "@/lib/attendance";
import { extraKinds, hoursShort, rejectOvertimeHours } from "@/lib/overtime";
import { localTime } from "@/lib/time";
import { errMsg, str, type FormState } from "./types";

/**
 * Làm ngoài giờ chờ xác nhận (ra muộn / vào sớm / ngoài ca): Duyệt = giữ giờ công (xoá khỏi danh sách chờ);
 * Từ chối = bỏ phần ngoài giờ (giờ vào = đầu ca / giờ ra = hết ca / ngoài ca = 0 giờ). Quyền: duyệt chấm công (adjustments).
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
    const what = extraKinds(a.overtime).join(" · ") || "làm ngoài giờ";
    if (approve) {
      await Attendance.updateOne(
        { _id: a._id, "overtime.status": "PENDING" },
        {
          $set: {
            "overtime.status": "APPROVED",
            "overtime.decidedBy": actor.name,
            "overtime.decidedAt": new Date(),
            "overtime.reply": reply,
            staffNote: `Admin đã duyệt: ${what}${a.overtime.deltaHours ? ` (+${hoursShort(a.overtime.deltaHours)} công)` : ""}${reply ? ` – ${reply}` : ""}.`,
          },
        },
      );
    } else {
      const { fields, inAt, outAt } = await rejectOvertimeHours(a);
      const real = `${hm(a.checkInAt)}–${hm(a.checkOutAt!)}`;
      await Attendance.updateOne(
        { _id: a._id, "overtime.status": "PENDING" },
        {
          $set: {
            ...fields,
            checkInAt: inAt,
            checkOutAt: outAt,
            "overtime.status": "REJECTED",
            "overtime.actualInAt": a.checkInAt,
            "overtime.actualOutAt": a.checkOutAt,
            "overtime.decidedBy": actor.name,
            "overtime.decidedAt": new Date(),
            "overtime.reply": reply,
            note: [
              a.note,
              a.overtime.outOfShift ? `Không duyệt công ngoài ca (thật ${real}) – 0 giờ` : `Không duyệt ngoài giờ (thật ${real}) – tính ${hm(inAt)}–${hm(outAt)}`,
            ]
              .filter(Boolean)
              .join(" | "),
            staffNote: `${
              a.overtime.outOfShift
                ? `Admin không duyệt công ngoài ca (${real}) – lượt này không tính công`
                : `Admin không duyệt làm ngoài giờ – chỉ tính công trong ca ${hm(inAt)}–${hm(outAt)}`
            }${reply ? ` (${reply})` : ""}.`,
          },
        },
      );
    }
    await audit(actor, approve ? "attendance.overtime.approve" : "attendance.overtime.reject", { type: "Attendance", id: String(a._id) }, null, {
      userId: String(a.userId),
      minutes: a.overtime.minutes,
      earlyInMinutes: a.overtime.earlyInMinutes,
      outOfShift: a.overtime.outOfShift,
      deltaHours: a.overtime.deltaHours,
      reply,
    });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
