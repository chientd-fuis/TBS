"use server";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { ShiftReminder, ShiftReminderSeen } from "@/lib/models";
import { REMINDER_SHIFT_OPTIONS } from "@/lib/reminders";
import { isYmd } from "@/lib/time";

export type ReminderInput = { id?: string; date: string; shift: string; storeIds: string[]; text: string; level: "NORMAL" | "IMPORTANT" };
type Res = { ok?: boolean; error?: string; id?: string };

const done = () => {
  revalidatePath("/admin/reminders");
  revalidatePath("/admin");
  revalidatePath("/", "layout");
};

/** Tạo / sửa nhắc nhở (Bảng tin Bơ Sầu) */
export async function saveReminder(input: ReminderInput): Promise<Res> {
  try {
    const admin = await assertPerm("reminders");
    await connectDB();
    const text = String(input.text ?? "").trim().slice(0, 200);
    if (!text) return { error: "Nhập nội dung nhắc nhở" };
    if (!isYmd(input.date)) return { error: "Chọn ngày" };
    if (!(REMINDER_SHIFT_OPTIONS as readonly string[]).includes(input.shift)) return { error: "Chọn ca" };
    const data = {
      date: input.date,
      shift: input.shift,
      storeIds: (Array.isArray(input.storeIds) ? input.storeIds : []).filter((s) => isValidObjectId(s)),
      text,
      level: input.level === "IMPORTANT" ? "IMPORTANT" : "NORMAL",
    };
    const actor = adminActor(admin);
    let id = input.id && isValidObjectId(input.id) ? input.id : "";
    if (id) {
      const r = await ShiftReminder.findByIdAndUpdate(id, { $set: data });
      if (!r) return { error: "Nhắc nhở không còn" };
      // đổi nội dung → nhân viên đã xem bản cũ sẽ thấy lại popup
      if (r.text !== text || r.date !== data.date || r.shift !== data.shift) await ShiftReminderSeen.deleteMany({ reminderId: id });
    } else id = String((await ShiftReminder.create({ ...data, createdBy: `Admin ${actor.name}` }))._id);
    await audit(actor, "reminder.save", { type: "ShiftReminder", id }, null, data);
    done();
    return { ok: true, id };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function deleteReminder(id: string): Promise<Res> {
  try {
    const admin = await assertPerm("reminders");
    await connectDB();
    if (!isValidObjectId(id)) return { error: "Không tìm thấy" };
    await ShiftReminder.deleteOne({ _id: id });
    await ShiftReminderSeen.deleteMany({ reminderId: id });
    await audit(adminActor(admin), "reminder.delete", { type: "ShiftReminder", id }, null, null);
    done();
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
