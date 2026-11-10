"use server";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { GoodsReceipt, Settings, Store } from "@/lib/models";
import { cleanInputs, getGoodsCatalog, GOODS_OFF, goodsEnabled, notifyGoods, type GoodsInput } from "@/lib/goods-server";
import { catalogToText, parseCatalog } from "@/lib/goods";
import { localDate } from "@/lib/time";
import { errMsg, str, type FormState } from "./types";

export type GoodsSaveResult = { ok?: boolean; error?: string; message?: string };

/** Admin nhập / sửa nhận hàng cho 1 cơ sở → (tuỳ chọn) báo nhóm Telegram cơ sở. id có → sửa bản ghi đó. */
export async function saveGoodsAdmin(input: { storeId: string; drafts: GoodsInput[]; telegram: boolean; id?: string }): Promise<GoodsSaveResult> {
  try {
    const admin = await assertPerm("goods");
    await connectDB();
    if (!(await goodsEnabled())) return { error: `${GOODS_OFF} – Admin Tổng bật lại ở Cài đặt` };
    if (!isValidObjectId(input?.storeId) || !(await Store.exists({ _id: input.storeId }))) return { error: "Chọn cơ sở" };
    const rows = cleanInputs(input.drafts, await getGoodsCatalog(), { max: localDate(new Date()) });
    const byName = admin.kind === "OWNER" ? "Admin Tổng" : `Admin ${admin.name}`;
    const tg = { status: input.telegram ? "PENDING" : "SKIPPED" };
    if (input.id) {
      const old = await GoodsReceipt.findById(input.id).lean().catch(() => null);
      if (!old) return { error: "Không tìm thấy lần nhận cần sửa" };
      const d = rows[0];
      await GoodsReceipt.updateOne({ _id: old._id }, { ...d, storeId: input.storeId, month: d.date.slice(0, 7), telegram: tg });
      await audit(adminActor(admin), "goods.update", { type: "GoodsReceipt", id: String(old._id) }, old, d);
      if (input.telegram) await notifyGoods(String(old._id), { edited: true });
      revalidatePath("/admin/goods");
      return { ok: true, message: "Đã sửa ✔" };
    }
    const ids: string[] = [];
    for (const d of rows) {
      const doc = await GoodsReceipt.create({ ...d, storeId: input.storeId, month: d.date.slice(0, 7), byName, byAdmin: true, telegram: tg });
      ids.push(String(doc._id));
    }
    await audit(adminActor(admin), "goods.create", { type: "GoodsReceipt", id: ids.join(",") }, null, rows);
    if (input.telegram) for (const id of ids) await notifyGoods(id);
    revalidatePath("/admin/goods");
    return { ok: true, message: `Đã ghi ${rows.length > 1 ? `${rows.length} lần nhận` : "nhận hàng"}${input.telegram ? " và báo nhóm cơ sở" : ""} ✔` };
  } catch (e) {
    const r = errMsg(e);
    return { error: r?.error };
  }
}

export async function deleteGoods(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods");
    await connectDB();
    const id = str(fd.get("id"));
    const r = isValidObjectId(id) ? await GoodsReceipt.findById(id).lean() : null;
    if (!r) return { error: "Không tìm thấy" };
    await GoodsReceipt.deleteOne({ _id: id });
    await audit(adminActor(admin), "goods.delete", { type: "GoodsReceipt", id }, r, null);
    revalidatePath("/admin/goods");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Danh mục nguyên liệu: mỗi dòng "Tên | đơn vị | cách gọi tắt, …" */
export async function saveGoodsCatalog(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods");
    await connectDB();
    const items = parseCatalog(str(fd.get("catalog")));
    if (!items.length) return { error: "Danh mục trống" };
    const before = catalogToText(await getGoodsCatalog());
    const text = catalogToText(items);
    await Settings.updateOne({ key: "main" }, { goodsCatalog: text }, { upsert: true });
    await audit(adminActor(admin), "goods.catalog", { type: "Settings" }, before, text);
    revalidatePath("/admin/goods");
    revalidatePath("/receive");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
