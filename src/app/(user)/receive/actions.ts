"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { isProbation, PROBATION_OFF } from "@/lib/probation";
import { GoodsReceipt } from "@/lib/models";
import { resolveClosingContext } from "@/lib/closing-context";
import { cleanAlsoReturn, hasLines, cleanInputs, cleanPhotos, type AlsoReturn, getGoodsCatalog, GOODS_OFF, goodsEnabled, notifyGoodsSaved, STOCK_OFF, stockEnabled, type GoodsInput } from "@/lib/goods-server";

export type GoodsSaveResult = { ok?: boolean; error?: string; message?: string };

/** Nhân viên ghi đồ đã nhận ở cơ sở đang làm (ca hỗ trợ → cơ sở hỗ trợ) → báo nhóm Telegram cơ sở. */
export async function saveGoodsUser(input: { drafts: GoodsInput[]; telegram: boolean; kind?: "RECEIVE" | "RETURN" | "STOCK"; reason?: string; photos?: string[]; alsoReturn?: AlsoReturn }): Promise<GoodsSaveResult> {
  try {
    const user = await requireActiveUser();
    if (isProbation(user)) return { error: PROBATION_OFF };
    if (!(await goodsEnabled())) return { error: GOODS_OFF };
    const kind = input?.kind === "STOCK" ? "STOCK" : input?.kind === "RETURN" ? "RETURN" : "RECEIVE";
    // trả hàng: bắt buộc lý do
    const reason = kind === "RETURN" ? String(input?.reason ?? "").trim().slice(0, 120) : "";
    if (kind === "RETURN" && !reason) return { error: "Chọn lý do trả hàng" };
    if (kind === "STOCK" && !(await stockEnabled())) return { error: STOCK_OFF };
    const ctx = await resolveClosingContext(user);
    if (!ctx) return { error: "Bạn chưa thuộc cơ sở nào" };
    // nhân viên: ngày nhận luôn là hôm nay, luôn báo nhóm Telegram cơ sở
    const drafts = (Array.isArray(input?.drafts) ? input.drafts : []).map((d) => ({ ...d, date: ctx.today }));
    const catalog = await getGoodsCatalog();
    // phiếu kiểm kê có số ở cột XUẤT → lưu luôn phần xuất (trả hàng) trong cùng lần bấm
    const also = kind === "RECEIVE" ? cleanAlsoReturn(input?.alsoReturn, catalog, { min: ctx.today, max: ctx.today }, ctx.today) : null;
    // phiếu chỉ có cột Xuất → chỉ lưu phần xuất
    const rows = also && !hasLines(drafts, catalog) ? [] : cleanInputs(drafts, catalog, { min: ctx.today, max: ctx.today }, kind);
    const saved: { id: string; source: string }[] = [];
    for (const d of rows) {
      const doc = await GoodsReceipt.create({ ...d, kind, ...(reason ? { reason } : {}), storeId: ctx.store._id, month: d.date.slice(0, 7), byUserId: user._id, byName: user.name || user.email, telegram: { status: "PENDING" } });
      saved.push({ id: String(doc._id), source: d.source });
    }
    await notifyGoodsSaved(saved, cleanPhotos(input?.photos));
    if (also) {
      const out: { id: string; source: string }[] = [];
      for (const d of also.rows) {
        const doc = await GoodsReceipt.create({ ...d, kind: "RETURN", reason: also.reason, storeId: ctx.store._id, month: d.date.slice(0, 7), byUserId: user._id, byName: user.name || user.email, telegram: { status: "PENDING" } });
        out.push({ id: String(doc._id), source: rows.length ? "MANUAL" : d.source });
      }
      await notifyGoodsSaved(out, rows.length ? undefined : cleanPhotos(input?.photos));
    }
    revalidatePath(kind === "STOCK" ? "/stock" : "/receive");
    const what = kind === "STOCK" ? "tồn kho" : kind === "RETURN" ? "trả hàng" : "nhận hàng";
    if (!rows.length) return { ok: true, message: "Đã ghi xuất (trả hàng) và báo nhóm ✔" };
    return { ok: true, message: `Đã ghi ${rows.length > 1 ? `${rows.length} lần ${what}` : what}${also ? " + xuất (trả hàng)" : ""} và báo nhóm ✔` };
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
  revalidatePath("/stock");
  return { ok: true };
}
