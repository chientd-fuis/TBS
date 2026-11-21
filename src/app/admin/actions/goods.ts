"use server";
import { track } from "@/lib/error-log";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { GoodsItemModel, GoodsReceipt, Store } from "@/lib/models";
import { cleanAlsoReturn, hasLines, cleanInputs, getGoodsCatalog, type AlsoReturn, getGoodsItems, GOODS_OFF, goodsEnabled, notifyGoods, notifyGoodsSaved, cleanPhotos, STOCK_OFF, stockEnabled, type GoodsInput } from "@/lib/goods-server";
import { foldGoods } from "@/lib/goods";
import { isYmd, localDate } from "@/lib/time";
import { errMsg, str, type FormState } from "./types";

export type GoodsSaveResult = { ok?: boolean; error?: string; message?: string };

/** Admin nhập / sửa nhận hàng cho 1 cơ sở → (tuỳ chọn) báo nhóm Telegram cơ sở. id có → sửa bản ghi đó. */
async function saveGoodsAdmin__(input: { storeId: string; drafts: GoodsInput[]; telegram: boolean; id?: string; kind?: "RECEIVE" | "RETURN" | "STOCK"; reason?: string; photos?: string[]; alsoReturn?: AlsoReturn }): Promise<GoodsSaveResult> {
  try {
    const admin = await assertPerm("goods");
    await connectDB();
    if (!(await goodsEnabled())) return { error: `${GOODS_OFF} – Admin Tổng bật lại ở Cài đặt` };
    const kind = input?.kind === "STOCK" ? "STOCK" : input?.kind === "RETURN" ? "RETURN" : "RECEIVE";
    // trả hàng: bắt buộc lý do
    const reason = kind === "RETURN" ? String(input?.reason ?? "").trim().slice(0, 120) : "";
    if (kind === "RETURN" && !reason) return { error: "Chọn lý do trả hàng" };
    if (kind === "STOCK" && !(await stockEnabled())) return { error: `${STOCK_OFF} – Admin Tổng bật ở Cài đặt` };
    if (!isValidObjectId(input?.storeId) || !(await Store.exists({ _id: input.storeId }))) return { error: "Chọn cơ sở" };
    const catalog = await getGoodsCatalog();
    // phiếu kiểm kê có số ở cột XUẤT → lưu luôn phần xuất (trả hàng) trong cùng lần bấm (chỉ khi thêm mới)
    const also = kind === "RECEIVE" && !input.id ? cleanAlsoReturn(input.alsoReturn, catalog, { max: localDate(new Date()) }) : null;
    const rows = also && !hasLines(input.drafts, catalog) ? [] : cleanInputs(input.drafts, catalog, { max: localDate(new Date()) }, kind);
    const byName = admin.kind === "OWNER" ? "Admin Tổng" : `Admin ${admin.name}`;
    const tg = { status: input.telegram ? "PENDING" : "SKIPPED" };
    if (input.id) {
      const old = await GoodsReceipt.findById(input.id).lean().catch(() => null);
      if (!old) return { error: "Không tìm thấy lần nhận cần sửa" };
      const d = rows[0];
      await GoodsReceipt.updateOne({ _id: old._id }, { ...d, ...(reason ? { reason } : {}), storeId: input.storeId, month: d.date.slice(0, 7), telegram: tg });
      await audit(adminActor(admin), "goods.update", { type: "GoodsReceipt", id: String(old._id) }, old, d);
      if (input.telegram) await notifyGoods(String(old._id), { edited: true });
      revalidateGoods();
      return { ok: true, message: "Đã sửa ✔" };
    }
    const saved: { id: string; source: string }[] = [];
    for (const d of rows) {
      const doc = await GoodsReceipt.create({ ...d, kind, ...(reason ? { reason } : {}), storeId: input.storeId, month: d.date.slice(0, 7), byName, byAdmin: true, telegram: tg });
      saved.push({ id: String(doc._id), source: d.source });
    }
    await audit(adminActor(admin), "goods.create", { type: "GoodsReceipt", id: saved.map((x) => x.id).join(",") }, null, rows);
    if (input.telegram) await notifyGoodsSaved(saved, cleanPhotos(input.photos));
    if (also) {
      const out: { id: string; source: string }[] = [];
      for (const d of also.rows) {
        const doc = await GoodsReceipt.create({ ...d, kind: "RETURN", reason: also.reason, storeId: input.storeId, month: d.date.slice(0, 7), byName, byAdmin: true, telegram: tg });
        out.push({ id: String(doc._id), source: rows.length ? "MANUAL" : d.source });
      }
      await audit(adminActor(admin), "goods.create", { type: "GoodsReceipt", id: out.map((x) => x.id).join(",") }, null, { kind: "RETURN", rows: also.rows });
      if (input.telegram) await notifyGoodsSaved(out, rows.length ? undefined : cleanPhotos(input.photos));
    }
    revalidateGoods();
    if (!rows.length) return { ok: true, message: `Đã ghi xuất (trả hàng)${input.telegram ? " và báo nhóm cơ sở" : ""} ✔` };
    const what = kind === "STOCK" ? "tồn kho" : kind === "RETURN" ? "trả hàng" : "nhận hàng";
    return { ok: true, message: `Đã ghi ${rows.length > 1 ? `${rows.length} lần ${what}` : what}${also ? " + xuất (trả hàng)" : ""}${input.telegram ? " và báo nhóm cơ sở" : ""} ✔` };
  } catch (e) {
    const r = errMsg(e);
    return { error: r?.error };
  }
}

async function deleteGoods__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods");
    await connectDB();
    const id = str(fd.get("id"));
    const r = isValidObjectId(id) ? await GoodsReceipt.findById(id).lean() : null;
    if (!r) return { error: "Không tìm thấy" };
    await GoodsReceipt.deleteOne({ _id: id });
    await audit(adminActor(admin), "goods.delete", { type: "GoodsReceipt", id }, r, null);
    revalidateGoods();
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---------- Nguyên liệu: thêm / sửa / xoá + giá nhập theo ngày ---------- */
const aliasList = (v: string) => [...new Set(v.split(",").map((x) => x.trim().slice(0, 40)).filter(Boolean))].slice(0, 20);
const revalidateGoods = () => ["/admin/goods", "/admin/goods/stock", "/admin/goods/items", "/admin/goods/report", "/receive", "/stock"].forEach((x) => revalidatePath(x));

/** Thêm (không có id) / sửa nguyên liệu. Đổi tên → đổi luôn tên trong các lần nhận / tồn kho cũ. */
async function saveGoodsItem__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods.items");
    await connectDB();
    await getGoodsItems(); // tạo danh mục lần đầu
    const id = str(fd.get("id"));
    const name = str(fd.get("name")).replace(/\s+/g, " ").slice(0, 60);
    if (!name) return { error: "Nhập tên nguyên liệu" };
    const data = { name, unit: str(fd.get("unit")).slice(0, 20), aliases: aliasList(str(fd.get("aliases"))) };
    const all = await GoodsItemModel.find().select("name").lean();
    const clash = all.find((x) => foldGoods(x.name) === foldGoods(name) && String(x._id) !== id);
    if (clash) return { error: `Đã có món “${clash.name}”` };
    if (id) {
      const old = isValidObjectId(id) ? await GoodsItemModel.findById(id).lean() : null;
      if (!old) return { error: "Không tìm thấy nguyên liệu" };
      await GoodsItemModel.updateOne({ _id: id }, data);
      if (old.name !== name) await GoodsReceipt.updateMany({ "items.name": old.name }, { $set: { "items.$[x].name": name } }, { arrayFilters: [{ "x.name": old.name }] });
      await audit(adminActor(admin), "goods.item.update", { type: "GoodsItem", id }, { name: old.name, unit: old.unit, aliases: old.aliases }, data);
    } else {
      const price = Math.round(Number(str(fd.get("price")).replace(/[.\s₫đ]/g, "").replace(/k$/i, "000")));
      const from = str(fd.get("from")) || localDate(new Date());
      const doc = await GoodsItemModel.create({
        ...data,
        order: all.length,
        prices: Number.isFinite(price) && price > 0 ? [{ from, price, by: adminActor(admin).name, at: new Date() }] : [],
      });
      await audit(adminActor(admin), "goods.item.create", { type: "GoodsItem", id: String(doc._id) }, null, data);
    }
    revalidateGoods();
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Xoá = ẩn khỏi danh mục (giữ lịch sử, khôi phục được). on=1 → khôi phục. */
async function toggleGoodsItem__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods.items");
    await connectDB();
    const id = str(fd.get("id"));
    const on = str(fd.get("on")) === "1";
    if (!isValidObjectId(id)) return { error: "Không tìm thấy" };
    await GoodsItemModel.updateOne({ _id: id }, { active: on });
    await audit(adminActor(admin), on ? "goods.item.restore" : "goods.item.delete", { type: "GoodsItem", id });
    revalidateGoods();
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Thêm mốc giá nhập: từ ngày `from` giá = `price` (cùng ngày → ghi đè). */
async function addGoodsPrice__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods.items");
    await connectDB();
    const id = str(fd.get("id"));
    const from = str(fd.get("from"));
    const raw = str(fd.get("price")).toLowerCase().replace(/[\s₫đ]/g, "");
    const price = /k$/.test(raw) ? Math.round(Number(raw.slice(0, -1).replace(",", ".")) * 1000) : Math.round(Number(raw.replace(/[.,]/g, "")));
    if (!isYmd(from)) return { error: "Chọn ngày áp dụng" };
    if (!Number.isFinite(price) || price <= 0 || price > 1_000_000_000) return { error: "Giá không hợp lệ (VD 20000 hoặc 20k)" };
    const item = isValidObjectId(id) ? await GoodsItemModel.findById(id).lean() : null;
    if (!item) return { error: "Không tìm thấy nguyên liệu" };
    const prices = ((item.prices ?? []) as { from: string; price: number }[]).filter((p) => p.from !== from);
    prices.push({ from, price, by: adminActor(admin).name, at: new Date() } as never);
    await GoodsItemModel.updateOne({ _id: id }, { prices });
    await audit(adminActor(admin), "goods.price.add", { type: "GoodsItem", id }, null, { name: item.name, from, price });
    revalidateGoods();
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

async function removeGoodsPrice__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("goods.items");
    await connectDB();
    const id = str(fd.get("id"));
    const from = str(fd.get("from"));
    if (!isValidObjectId(id)) return { error: "Không tìm thấy" };
    await GoodsItemModel.updateOne({ _id: id }, { $pull: { prices: { from } } });
    await audit(adminActor(admin), "goods.price.remove", { type: "GoodsItem", id }, { from }, null);
    revalidateGoods();
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function saveGoodsAdmin(...a: Parameters<typeof saveGoodsAdmin__>) { return track("Admin › Hàng hoá", "saveGoodsAdmin", () => saveGoodsAdmin__(...a)); }
export async function deleteGoods(...a: Parameters<typeof deleteGoods__>) { return track("Admin › Hàng hoá", "deleteGoods", () => deleteGoods__(...a)); }
export async function saveGoodsItem(...a: Parameters<typeof saveGoodsItem__>) { return track("Admin › Hàng hoá", "saveGoodsItem", () => saveGoodsItem__(...a)); }
export async function toggleGoodsItem(...a: Parameters<typeof toggleGoodsItem__>) { return track("Admin › Hàng hoá", "toggleGoodsItem", () => toggleGoodsItem__(...a)); }
export async function addGoodsPrice(...a: Parameters<typeof addGoodsPrice__>) { return track("Admin › Hàng hoá", "addGoodsPrice", () => addGoodsPrice__(...a)); }
export async function removeGoodsPrice(...a: Parameters<typeof removeGoodsPrice__>) { return track("Admin › Hàng hoá", "removeGoodsPrice", () => removeGoodsPrice__(...a)); }
