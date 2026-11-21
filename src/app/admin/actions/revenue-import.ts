"use server";
import { track } from "@/lib/error-log";
import { revalidatePath } from "next/cache";
import { assertOwner, assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { RevenueGap, ShiftClosing, Store } from "@/lib/models";
import { compareImport, parseRevenueFile, type ImportRow } from "@/lib/revenue-import";
import { fold, approveRevenueGap, rejectRevenueGap } from "@/lib/revenue-gap";
import { errMsg, str, type FormState } from "./types";

export type ImportPreview = {
  ok?: boolean;
  error?: string;
  fileName?: string;
  branch?: string;
  from?: string;
  to?: string;
  total?: number;
  days?: number;
  storeId?: string;
  storeMatched?: boolean;
  rows?: ImportRow[];
};

/** Bước 1–2: đọc file KiotViet + so với DT máy đang có (chưa ghi gì). Quyền Doanh thu. */
async function previewRevenueImport__(fd: FormData): Promise<ImportPreview> {
  try {
    const admin = await assertOwner(); // chỉ Admin Tổng (import / hoàn tác DT máy)
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Chọn file báo cáo (.xlsx / .xls / .pdf)" };
    if (file.size > 8 * 1024 * 1024) return { error: "File quá lớn (tối đa 8MB)" };
    const rep = await parseRevenueFile(file.name, Buffer.from(await file.arrayBuffer()), `admin:${admin.accountId ?? "owner"}`);
    if (!rep.rows.length) return { error: "Không đọc được dòng ngày + doanh thu nào – kiểm tra đúng “Báo cáo bán hàng theo thời gian” chưa" };
    // cơ sở: admin chọn, không thì tự nhận theo tên chi nhánh trong file
    let storeId = str(fd.get("storeId"));
    let matched = false;
    if (!storeId) {
      const stores = await Store.find({ active: { $ne: false } }).select("name").lean();
      const b = fold(rep.branch);
      const hit = b ? stores.find((s) => fold(s.name).includes(b) || b.includes(fold(s.name).replace(/^tbs\s+/, ""))) : undefined;
      if (hit) [storeId, matched] = [String(hit._id), true];
    }
    if (!storeId) return { ok: true, fileName: file.name, branch: rep.branch, from: rep.from, to: rep.to, total: rep.total, days: rep.rows.length, rows: [] };
    const rows = await compareImport(storeId, rep.rows, { includeToday: fd.get("includeToday") === "on", fallbackLatest: str(fd.get("missing")) === "latest" });
    return { ok: true, fileName: file.name, branch: rep.branch, from: rep.from, to: rep.to, total: rep.total, days: rep.rows.length, storeId, storeMatched: matched, rows };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export type ApplyResult = { ok?: boolean; error?: string; updated?: { date: string; prev: number | null; dt: number; closingId: string }[]; gaps?: { date: string; total: number }[] };

/** Bước 3: ghi DT máy vào lượt chốt ca đã chọn → tính lại doanh thu ngày (+ sheet) → ngày thiếu tiền tự có yêu cầu bù doanh thu. */
async function applyRevenueImport__(storeId: string, items: { closingId: string; date: string; dt: number }[], fileName: string): Promise<ApplyResult> {
  try {
    const admin = await assertOwner();
    const actor = adminActor(admin);
    const { recomputeDay, syncDaySheet } = await import("@/lib/day-revenue");
    const updated: NonNullable<ApplyResult["updated"]> = [];
    for (const it of items.slice(0, 62)) {
      const dt = Math.round(Number(it.dt));
      if (!Number.isFinite(dt) || dt < 0) continue;
      const c = await ShiftClosing.findOne({ _id: it.closingId, storeId, workDate: it.date }).select("revenue workDate").lean();
      if (!c) continue;
      const prev = c.revenue?.dt ?? null;
      if (prev === dt) continue;
      await ShiftClosing.updateOne(
        { _id: c._id },
        { $set: { "revenue.dt": dt, "revenueInput.dt": String(dt), dtImport: { at: new Date(), by: actor.name, prev, file: fileName.slice(0, 120) } } },
      );
      const { wasSynced, changed } = await recomputeDay(storeId, it.date); // → syncRevenueGap
      if (wasSynced && changed) await syncDaySheet(storeId, it.date).catch(() => null);
      updated.push({ date: it.date, prev, dt, closingId: String(c._id) });
    }
    await audit(actor, "closing.importDt", { type: "Store", id: storeId }, null, { fileName, updated });
    const gaps = (await RevenueGap.find({ storeId, date: { $in: updated.map((u) => u.date) }, status: "PENDING" }).select("date total").lean()).map((g) => ({
      date: g.date,
      total: g.total ?? 0,
    }));
    revalidatePath("/admin/closings");
    revalidatePath("/admin/finance", "layout");
    revalidatePath("/admin/requests");
    return { ok: true, updated, gaps };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Hoàn tác lần import vừa rồi: trả DT máy về số cũ (chỉ lượt vẫn còn đúng số đã import). */
async function undoRevenueImport__(storeId: string, updated: { date: string; prev: number | null; dt: number; closingId: string }[]): Promise<ApplyResult> {
  try {
    const admin = await assertOwner();
    const { recomputeDay, syncDaySheet } = await import("@/lib/day-revenue");
    for (const u of updated) {
      const r = await ShiftClosing.updateOne(
        { _id: u.closingId, storeId, "revenue.dt": u.dt },
        { $set: { "revenue.dt": u.prev, "revenueInput.dt": u.prev == null ? "" : String(u.prev) }, $unset: { dtImport: 1 } },
      );
      if (!r.modifiedCount) continue;
      const { wasSynced, changed } = await recomputeDay(storeId, u.date);
      if (wasSynced && changed) await syncDaySheet(storeId, u.date).catch(() => null);
    }
    await audit(adminActor(admin), "closing.importDt.undo", { type: "Store", id: storeId }, null, { updated });
    revalidatePath("/admin/closings");
    revalidatePath("/admin/finance", "layout");
    revalidatePath("/admin/requests");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Yêu cầu → Bù doanh thu: Duyệt (ghi phạt theo số admin chốt từng ca) / Không phạt. Quyền Doanh thu. */
async function resolveRevenueGap__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("revenue");
    const id = str(fd.get("id"));
    const reply = str(fd.get("reply")).slice(0, 200);
    const by = adminActor(admin).name;
    if (str(fd.get("op")) === "reject") await rejectRevenueGap(id, by, reply);
    else {
      const amounts: Record<number, number> = {};
      for (const [k, v] of fd.entries()) {
        const m = /^amt_(\d+)$/.exec(k);
        if (m) amounts[Number(m[1])] = Number(String(v).replace(/[^\d]/g, "")) || 0;
      }
      await approveRevenueGap(id, amounts, by, reply);
    }
    await audit(adminActor(admin), "revenueGap.resolve", { type: "RevenueGap", id }, null, { op: str(fd.get("op")) || "approve", reply });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function previewRevenueImport(...a: Parameters<typeof previewRevenueImport__>) { return track("Admin › Nhập doanh thu", "previewRevenueImport", () => previewRevenueImport__(...a)); }
export async function applyRevenueImport(...a: Parameters<typeof applyRevenueImport__>) { return track("Admin › Nhập doanh thu", "applyRevenueImport", () => applyRevenueImport__(...a)); }
export async function undoRevenueImport(...a: Parameters<typeof undoRevenueImport__>) { return track("Admin › Nhập doanh thu", "undoRevenueImport", () => undoRevenueImport__(...a)); }
export async function resolveRevenueGap(...a: Parameters<typeof resolveRevenueGap__>) { return track("Admin › Nhập doanh thu", "resolveRevenueGap", () => resolveRevenueGap__(...a)); }
