"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { RevenuePickup, Store } from "@/lib/models";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";

/** Menu Doanh thu: tick / bỏ tick "đã lấy doanh thu" (chưa đếm) của 1 cơ sở 1 ngày. */
export async function setRevenuePickup(storeId: string, date: string, picked: boolean): Promise<{ ok?: boolean; error?: string; by?: string; at?: string }> {
  try {
    const admin = await assertPerm("revenue");
    await connectDB();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[a-f\d]{24}$/i.test(storeId)) return { error: "Dữ liệu không hợp lệ" };
    if (!(await Store.exists({ _id: storeId }))) return { error: "Không tìm thấy cơ sở" };
    const actor = adminActor(admin);
    let at = new Date();
    if (picked) {
      const doc = await RevenuePickup.findOneAndUpdate(
        { storeId, date },
        { $setOnInsert: { storeId, date, month: date.slice(0, 7), by: actor.name } },
        { upsert: true, returnDocument: "after" },
      ).lean();
      at = doc?.createdAt ?? at;
      await audit(actor, "revenue.pickup", { type: "Store", id: `${storeId}:${date}` }, null, { picked: true });
      revalidatePath("/admin/revenue");
      revalidatePath("/admin/finance/cashbook/count"); // tích xanh sau ngày ở Đếm tiền
      return { ok: true, by: doc?.by ?? actor.name, at: at.toISOString() };
    }
    await RevenuePickup.deleteOne({ storeId, date });
    await audit(actor, "revenue.pickup", { type: "Store", id: `${storeId}:${date}` }, null, { picked: false });
    revalidatePath("/admin/revenue");
    revalidatePath("/admin/finance/cashbook/count");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "Không lưu được" };
  }
}
