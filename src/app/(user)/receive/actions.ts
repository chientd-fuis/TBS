"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { GoodsReceipt } from "@/lib/models";
import { resolveClosingContext } from "@/lib/closing-context";
import { cleanInputs, getGoodsCatalog, GOODS_OFF, goodsEnabled, notifyGoods, type GoodsInput } from "@/lib/goods-server";
import { addDays } from "@/lib/time";

export type GoodsSaveResult = { ok?: boolean; error?: string; message?: string };

/** Nhân viên ghi đồ đã nhận ở cơ sở đang làm (ca hỗ trợ → cơ sở hỗ trợ) → báo nhóm Telegram cơ sở. */
export async function saveGoodsUser(input: { drafts: GoodsInput[]; telegram: boolean }): Promise<GoodsSaveResult> {
  try {
    const user = await requireActiveUser();
    if (!(await goodsEnabled())) return { error: GOODS_OFF };
    const ctx = await resolveClosingContext(user);
    if (!ctx) return { error: "Bạn chưa thuộc cơ sở nào" };
    const rows = cleanInputs(input?.drafts, await getGoodsCatalog(), { min: addDays(ctx.today, -7), max: ctx.today });
    const ids: string[] = [];
    for (const d of rows) {
      const doc = await GoodsReceipt.create({ ...d, storeId: ctx.store._id, month: d.date.slice(0, 7), byUserId: user._id, byName: user.name || user.email, telegram: { status: input?.telegram ? "PENDING" : "SKIPPED" } });
      ids.push(String(doc._id));
    }
    if (input?.telegram) for (const id of ids) await notifyGoods(id);
    revalidatePath("/receive");
    return { ok: true, message: `Đã ghi ${rows.length > 1 ? `${rows.length} lần nhận` : "nhận hàng"}${input?.telegram ? " và báo nhóm" : ""} ✔` };
  } catch (e) {
    const err = e as { digest?: string; message?: string };
    if (err?.digest?.startsWith("NEXT_REDIRECT")) throw e;
    return { error: err?.message || "Lỗi hệ thống" };
  }
}

/** Nhân viên xoá lần ghi nhầm của chính mình (trong 24 giờ). */
export async function deleteGoodsUser(_: unknown, fd: FormData): Promise<{ ok?: boolean; error?: string } | null> {
  const user = await requireActiveUser();
  if (!(await goodsEnabled())) return { error: GOODS_OFF };
  const r = await GoodsReceipt.findOne({ _id: String(fd.get("id") ?? ""), byUserId: user._id, byAdmin: { $ne: true } }).lean().catch(() => null);
  if (!r) return { error: "Không tìm thấy" };
  if (Date.now() - new Date(r.createdAt ?? 0).getTime() > 24 * 3600_000) return { error: "Quá 24 giờ – nhờ admin sửa" };
  await GoodsReceipt.deleteOne({ _id: r._id });
  revalidatePath("/receive");
  return { ok: true };
}
