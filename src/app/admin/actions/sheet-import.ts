"use server";
import { revalidatePath } from "next/cache";
import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/db";
import { CashCount, DayRevenue, RevenuePickup, ShiftClosing, Store } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { track } from "@/lib/error-log";
import { localMonth } from "@/lib/time";
import { sheetLayoutOf, type Revenue, type SheetLayout } from "@/lib/revenue";
import { looksThousands, parseMonthGrid, tabMonth } from "@/lib/sheet-import";

/*
 * Chốt ca → Import từ Google Sheet: lấy doanh thu các THÁNG CŨ (tab "T10-26", "T10"…) trên sheet của cơ sở
 * → mỗi ngày 1 lượt chốt "Tối" (gắn nhãn import). Chỉ Admin Tổng (ảnh hưởng Sổ quỹ).
 * Tuỳ chọn "đã lấy tiền" (mặc định bật): đánh dấu đã lấy + đã đếm tiền, KHÔNG đưa tiền mặt / tài khoản vào Sổ quỹ.
 * Không gửi Telegram, không tạo yêu cầu bù doanh thu, không ghi ngược lên sheet. Ngày đã có chốt ca trên app → bỏ qua.
 */

const IMPORT_BY = "Import Google Sheet";
const isMonth = (m: unknown): m is string => typeof m === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

type StoreCfg = { _id: unknown; name: string; revenueSheetId?: string | null; revenueTabPattern?: string | null; revenueFirstRow?: number | null; revenueSheetLayout?: string | null };

async function loadStore(storeId: string): Promise<StoreCfg> {
  if (!isValidObjectId(storeId)) throw new Error("Chọn cơ sở");
  await connectDB();
  const s = await Store.findById(storeId).select("name revenueSheetId revenueTabPattern revenueFirstRow revenueSheetLayout").lean();
  if (!s) throw new Error("Không tìm thấy cơ sở");
  if (!s.revenueSheetId) throw new Error("Cơ sở này chưa gắn Google Sheet doanh thu (Cơ sở → Google Sheet)");
  return s as StoreCfg;
}

const friendly = (e: unknown) => {
  const msg = (e as Error)?.message ?? String(e);
  if (/does not have permission|PERMISSION_DENIED|403/i.test(msg)) return "Service account chưa được share quyền file sheet";
  if (/Unable to parse range/i.test(msg)) return "Không đọc được tab này trên sheet";
  return msg;
};

export type SheetTab = { tab: string; month: string | null; past: boolean };
export type TabsResult = { error?: string; title?: string; tabs?: SheetTab[]; curMonth?: string };

async function sheetImportTabs__(storeId: string): Promise<TabsResult> {
  try {
    await assertOwner();
    const s = await loadStore(storeId);
    const { listSheetTabs } = await import("@/lib/sheets");
    const r = await listSheetTabs(s);
    const cur = localMonth(new Date());
    const tabs = r.tabs.map((tab) => {
      const month = tabMonth(tab, cur);
      return { tab, month, past: !!month && month < cur };
    });
    // tab có tháng lên trước, mới → cũ
    tabs.sort((a, b) => (b.month ?? "").localeCompare(a.month ?? ""));
    return { title: r.title, tabs, curMonth: cur };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export type PreviewRow = { date: string; revenue: Revenue; note: string; status: "new" | "exists" | "imported" };
export type SheetPreview = { error?: string; rows?: PreviewRow[]; thousands?: boolean; layout?: SheetLayout; firstRow?: number };

async function readMonth(s: StoreCfg, tab: string, month: string, scale: number) {
  const { readSheetGrid } = await import("@/lib/sheets");
  const firstRow = s.revenueFirstRow || 3;
  const layout = sheetLayoutOf(s);
  const grid = await readSheetGrid(s, tab, firstRow + 31);
  const days = parseMonthGrid(grid, { layout, firstRow, month, scale });
  // ngày đã có chốt ca trên app (nhân viên chốt / admin nhập bù / đã import)
  const have = await ShiftClosing.find({ storeId: s._id, workDate: { $gte: `${month}-01`, $lte: `${month}-31` } }).select("workDate imported").lean();
  const st = new Map<string, "exists" | "imported">();
  for (const c of have) if (st.get(c.workDate) !== "exists") st.set(c.workDate, c.imported?.source === "SHEET" ? "imported" : "exists");
  return { layout, firstRow, days, rows: days.map((d) => ({ date: d.date, revenue: d.revenue, note: d.note, status: st.get(d.date) ?? ("new" as const) })) };
}

function checkInput(i: { storeId?: string; tab?: string; month?: string }) {
  if (!i?.tab || typeof i.tab !== "string") throw new Error("Chọn tab tháng");
  if (!isMonth(i.month)) throw new Error("Tháng không hợp lệ");
  if (i.month >= localMonth(new Date())) throw new Error("Chỉ import tháng cũ (trước tháng này) – tháng hiện tại app tự ghi khi nhân viên chốt ca");
}

async function previewSheetImport__(i: { storeId: string; tab: string; month: string; scale?: number }): Promise<SheetPreview> {
  try {
    await assertOwner();
    checkInput(i);
    const s = await loadStore(i.storeId);
    const r = await readMonth(s, i.tab, i.month, i.scale === 1000 ? 1000 : 1);
    return { rows: r.rows, layout: r.layout, firstRow: r.firstRow, thousands: i.scale !== 1000 && looksThousands(r.days) };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export type ApplyResult = { ok?: boolean; error?: string; created?: number; skipped?: number };

async function applySheetImport__(i: { storeId: string; tab: string; month: string; scale?: number; markTaken?: boolean }): Promise<ApplyResult> {
  try {
    const admin = await assertOwner();
    checkInput(i);
    const s = await loadStore(i.storeId);
    const res = await applyOne(admin, s, i);
    revalidateAll();
    return res;
  } catch (e) {
    return { error: friendly(e) };
  }
}

const revalidateAll = () => {
  revalidatePath("/admin/closings");
  revalidatePath("/admin/finance", "layout");
  revalidatePath("/admin/revenue");
};

/** Nhập 1 tab tháng của 1 cơ sở (đã kiểm tra quyền + đầu vào). */
async function applyOne(admin: Awaited<ReturnType<typeof assertOwner>>, s: StoreCfg, i: { tab: string; month: string; scale?: number; markTaken?: boolean }): Promise<ApplyResult> {
  const r = await readMonth(s, i.tab, i.month, i.scale === 1000 ? 1000 : 1);
  const todo = r.rows.filter((x) => x.status === "new");
  const markTaken = i.markTaken !== false;
  const { recomputeDay } = await import("@/lib/day-revenue");
  const now = new Date();
  for (const d of todo) {
    await ShiftClosing.create({
      storeId: s._id,
      workDate: d.date,
      shiftName: "Tối",
      isDayEnd: true,
      employeeName: IMPORT_BY,
      addedByAdmin: admin.name,
      note: d.note ? `Sheet: ${d.note}` : "",
      revenue: d.revenue,
      telegram: { status: "DISABLED" },
      imported: { source: "SHEET", tab: i.tab, at: now, by: admin.name, noCashbook: markTaken },
      // xếp đúng chỗ trong lịch sử chốt ca (không nhảy lên đầu danh sách)
      createdAt: new Date(`${d.date}T23:00:00+07:00`),
    });
    await recomputeDay(String(s._id), d.date, { quiet: true });
    if (markTaken) {
      await RevenuePickup.updateOne({ storeId: s._id, date: d.date }, { $setOnInsert: { month: i.month, by: IMPORT_BY } }, { upsert: true });
      await CashCount.updateOne({ storeId: s._id, date: d.date }, { $setOnInsert: { countedAt: now, countedBy: IMPORT_BY } }, { upsert: true });
    }
  }
  await audit(adminActor(admin), "closing.sheetImport", { type: "Store", id: String(s._id) }, null, {
    tab: i.tab,
    month: i.month,
    created: todo.length,
    skipped: r.rows.length - todo.length,
    scale: i.scale === 1000 ? 1000 : 1,
    markTaken,
  });
  return { ok: true, created: todo.length, skipped: r.rows.length - todo.length };
}

/* ---- Import HÀNG LOẠT: nhiều cơ sở × nhiều tab tháng 1 lần ---- */
export type BatchItem = { storeId: string; tab: string; month: string; scale?: number };
export type BatchPreviewItem = BatchItem & { storeName: string } & SheetPreview;
export type BatchApplyItem = BatchItem & { storeName: string } & ApplyResult;
const BATCH_MAX = 60;

function checkBatch(items: BatchItem[]) {
  if (!Array.isArray(items) || !items.length) throw new Error("Chọn ít nhất 1 tab tháng");
  if (items.length > BATCH_MAX) throw new Error(`Tối đa ${BATCH_MAX} tab mỗi lần – chia nhỏ ra`);
}

/** Xem trước nhiều tab: mỗi tab đọc riêng, lỗi tab nào báo tab đó (không dừng cả lô). */
async function previewSheetBatch__(items: BatchItem[]): Promise<{ error?: string; items?: BatchPreviewItem[] }> {
  try {
    await assertOwner();
    checkBatch(items);
    const stores = new Map<string, StoreCfg>();
    const out: BatchPreviewItem[] = [];
    for (const i of items) {
      let s = stores.get(i.storeId);
      try {
        checkInput(i);
        if (!s) stores.set(i.storeId, (s = await loadStore(i.storeId)));
        const r = await readMonth(s, i.tab, i.month, i.scale === 1000 ? 1000 : 1);
        out.push({ ...i, storeName: s.name, rows: r.rows, layout: r.layout, firstRow: r.firstRow, thousands: i.scale !== 1000 && looksThousands(r.days) });
      } catch (e) {
        out.push({ ...i, storeName: s?.name ?? "?", error: friendly(e) });
      }
    }
    return { items: out };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/** Nhập nhiều tab 1 lần (tuần tự – tab trùng tháng của cùng cơ sở: tab sau tự bỏ qua ngày đã import). */
async function applySheetBatch__(items: BatchItem[], markTaken = true): Promise<{ error?: string; items?: BatchApplyItem[] }> {
  try {
    const admin = await assertOwner();
    checkBatch(items);
    const stores = new Map<string, StoreCfg>();
    const out: BatchApplyItem[] = [];
    for (const i of items) {
      let s = stores.get(i.storeId);
      try {
        checkInput(i);
        if (!s) stores.set(i.storeId, (s = await loadStore(i.storeId)));
        out.push({ ...i, storeName: s.name, ...(await applyOne(admin, s, { ...i, markTaken })) });
      } catch (e) {
        out.push({ ...i, storeName: s?.name ?? "?", error: friendly(e) });
      }
    }
    revalidateAll();
    return { items: out };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/** Xoá dữ liệu đã import của 1 tháng (import nhầm tab / sai đơn vị → xoá rồi import lại). Không đụng chốt ca thật. */
async function undoSheetImport__(i: { storeId: string; month: string }): Promise<ApplyResult> {
  try {
    const admin = await assertOwner();
    if (!isMonth(i?.month)) return { error: "Tháng không hợp lệ" };
    if (!isValidObjectId(i.storeId)) return { error: "Chọn cơ sở" };
    await connectDB();
    const q = { storeId: i.storeId, workDate: { $gte: `${i.month}-01`, $lte: `${i.month}-31` }, "imported.source": "SHEET" };
    const list = await ShiftClosing.find(q).select("workDate").lean();
    if (!list.length) return { error: "Tháng này chưa có dữ liệu import từ sheet" };
    const dates = [...new Set(list.map((c) => c.workDate))];
    await ShiftClosing.deleteMany(q);
    await RevenuePickup.deleteMany({ storeId: i.storeId, date: { $in: dates }, by: IMPORT_BY });
    await CashCount.deleteMany({ storeId: i.storeId, date: { $in: dates }, countedBy: IMPORT_BY });
    const { recomputeDay } = await import("@/lib/day-revenue");
    for (const d of dates) {
      if (await ShiftClosing.exists({ storeId: i.storeId, workDate: d })) await recomputeDay(i.storeId, d, { quiet: true });
      else await DayRevenue.deleteOne({ storeId: i.storeId, date: d });
    }
    await audit(adminActor(admin), "closing.sheetImport.undo", { type: "Store", id: i.storeId }, null, { month: i.month, deleted: list.length });
    revalidatePath("/admin/closings");
    revalidatePath("/admin/finance", "layout");
    revalidatePath("/admin/revenue");
    return { ok: true, created: 0, skipped: list.length };
  } catch (e) {
    return { error: friendly(e) };
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function sheetImportTabs(...a: Parameters<typeof sheetImportTabs__>) { return track("Admin › Import chốt ca từ Google Sheet", "sheetImportTabs", () => sheetImportTabs__(...a)); }
export async function previewSheetImport(...a: Parameters<typeof previewSheetImport__>) { return track("Admin › Import chốt ca từ Google Sheet", "previewSheetImport", () => previewSheetImport__(...a)); }
export async function applySheetImport(...a: Parameters<typeof applySheetImport__>) { return track("Admin › Import chốt ca từ Google Sheet", "applySheetImport", () => applySheetImport__(...a)); }
export async function previewSheetBatch(...a: Parameters<typeof previewSheetBatch__>) { return track("Admin › Import chốt ca từ Google Sheet", "previewSheetBatch", () => previewSheetBatch__(...a)); }
export async function applySheetBatch(...a: Parameters<typeof applySheetBatch__>) { return track("Admin › Import chốt ca từ Google Sheet", "applySheetBatch", () => applySheetBatch__(...a)); }
export async function undoSheetImport(...a: Parameters<typeof undoSheetImport__>) { return track("Admin › Import chốt ca từ Google Sheet", "undoSheetImport", () => undoSheetImport__(...a)); }
