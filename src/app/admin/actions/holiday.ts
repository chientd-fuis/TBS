"use server";
import { revalidatePath } from "next/cache";
import { Holiday, Payroll } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { generatePayroll } from "@/lib/payroll";
import { HOLIDAY_MULTIPLIERS } from "@/lib/holiday";
import { errMsg, str, type FormState } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const multOf = (v: unknown) => {
  const n = Number(v);
  return (HOLIDAY_MULTIPLIERS as readonly number[]).includes(n) ? n : 2;
};

/** Tính lại bảng lương NHÁP của các tháng bị ảnh hưởng; bảng đã công bố giữ nguyên (đã chốt). */
async function recalc(months: string[]) {
  const list = await Payroll.find({ month: { $in: [...new Set(months)] }, status: "DRAFT" }).select("storeId month").lean();
  for (const p of list) await generatePayroll(String(p.storeId), p.month);
  revalidatePath("/admin", "layout");
}

export async function saveHoliday(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const id = str(fd.get("id"));
    const date = str(fd.get("date"));
    const name = str(fd.get("name")).slice(0, 80);
    const multiplier = multOf(fd.get("multiplier"));
    if (!DATE_RE.test(date)) return { error: "Chọn ngày" };
    if (name.length < 2) return { error: "Nhập tên ngày lễ" };
    const dup = await Holiday.findOne({ date, ...(id ? { _id: { $ne: id } } : {}) }).lean();
    if (dup) return { error: `Ngày này đã có: ${dup.name}` };
    const before = id ? await Holiday.findById(id).lean() : null;
    if (id) await Holiday.updateOne({ _id: id }, { $set: { date, name, multiplier } });
    else await Holiday.create({ date, name, multiplier, createdBy: adminActor(admin).name });
    await audit(adminActor(admin), id ? "holiday.update" : "holiday.create", { type: "Holiday", id: id || date }, before, { date, name, multiplier });
    await recalc([date.slice(0, 7), ...(before ? [before.date.slice(0, 7)] : [])]);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

export async function deleteHoliday(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const h = await Holiday.findById(str(fd.get("id"))).lean();
    if (!h) return { error: "Không tìm thấy ngày lễ" };
    await Holiday.deleteOne({ _id: h._id });
    await audit(adminActor(admin), "holiday.delete", { type: "Holiday", id: String(h._id) }, h, null);
    await recalc([h.date.slice(0, 7)]);
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Thêm nhanh các ngày lễ dương lịch cố định của 1 năm (ngày lễ âm lịch – Tết, Giỗ Tổ – admin thêm tay). */
export async function addSolarHolidays(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const year = Number(str(fd.get("year")));
    if (!(year >= 2020 && year <= 2100)) return { error: "Năm không hợp lệ" };
    const multiplier = multOf(fd.get("multiplier"));
    const list = [
      ["01-01", "Tết Dương lịch"],
      ["04-30", "Giải phóng miền Nam"],
      ["05-01", "Quốc tế Lao động"],
      ["09-02", "Quốc khánh"],
    ];
    let n = 0;
    for (const [md, name] of list) {
      const date = `${year}-${md}`;
      if (await Holiday.exists({ date })) continue;
      await Holiday.create({ date, name, multiplier, createdBy: adminActor(admin).name });
      n++;
    }
    await audit(adminActor(admin), "holiday.addSolar", { type: "Holiday", id: String(year) }, null, { year, added: n, multiplier });
    await recalc(list.map(([md]) => `${year}-${md.slice(0, 2)}`));
    return n ? { ok: true } : { error: "Các ngày lễ dương lịch năm này đã có đủ" };
  } catch (e) {
    return errMsg(e);
  }
}
