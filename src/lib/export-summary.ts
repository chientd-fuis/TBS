import type ExcelJS from "exceljs";
import { APPROVED_SHIFT, Attendance, Expense, FixedCost, ShiftAssignment, ShiftClosing } from "./models";
import { loadDayRevenue, loadPnl, loadStores, type StoreLite } from "./finance-data";
import { CATEGORY_LABEL, isCountedExpense, margin, type PnlResult } from "./finance";
import { closingSum, revenueDiff, type Revenue } from "./revenue";
import { localDate, monthRange, viDate, viMonth, weekdayVi } from "./time";

/*
 * Xuất "Tổng hợp tháng": mỗi tháng 1 sheet, đầy đủ thông tin kinh doanh của cả chuỗi
 * (không tổng hợp theo từng nhân viên):
 *  A. Lãi lỗ tháng   B. Doanh thu theo ngày × cơ sở   C. Chi tiết chốt ca
 *  D. Chi phí admin nhập   E. Mặt bằng   F. Chấm công theo cơ sở
 */

const C = {
  brand: "FF783C3C",
  header: "FFFCCC18",
  headerText: "FF542424",
  section: "FFFFF4D6",
  total: "FFE3F3E7",
  warn: "FFFDE8E8",
  muted: "FF7A6A5A",
};
const VND = '#,##0;[Red]-#,##0';

type Cell = string | number | null | undefined;

class Writer {
  r = 1;
  constructor(public ws: ExcelJS.Worksheet) {}
  title(text: string, size = 12) {
    const c = this.ws.getCell(this.r, 1);
    c.value = text;
    c.font = { bold: true, size, color: { argb: C.brand } };
    this.r++;
  }
  note(text: string) {
    const c = this.ws.getCell(this.r, 1);
    c.value = text;
    c.font = { italic: true, size: 9, color: { argb: C.muted } };
    this.r++;
  }
  gap(n = 1) {
    this.r += n;
  }
  section(text: string, width: number) {
    const row = this.ws.getRow(this.r);
    row.getCell(1).value = text;
    row.font = { bold: true, size: 12, color: { argb: C.brand } };
    for (let i = 1; i <= width; i++) row.getCell(i).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.section } };
    this.r++;
  }
  header(cols: string[]) {
    const row = this.ws.getRow(this.r);
    cols.forEach((h, i) => {
      const c = row.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: C.headerText } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.header } };
      c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    });
    row.height = 30;
    this.r++;
  }
  row(values: Cell[], opt: { bold?: boolean; fill?: string; money?: number[]; indent?: number; italic?: boolean } = {}) {
    const row = this.ws.getRow(this.r);
    values.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v ?? null;
      if (typeof v === "number" && (!opt.money || opt.money.includes(i))) c.numFmt = VND;
      if (typeof v === "string" && v.length > 16 && i > 0) c.alignment = { wrapText: true, vertical: "top" };
      if (opt.fill) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opt.fill } };
    });
    if (opt.indent) row.getCell(1).alignment = { indent: opt.indent };
    if (opt.bold || opt.italic) row.font = { bold: !!opt.bold, italic: !!opt.italic };
    this.r++;
    return row;
  }
}

const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const short = (n: string) => n.replace(/^TBS\s*/i, "");

type Lean<T> = T & Record<string, unknown>;
export type MonthSummaryData = {
  month: string;
  first: string;
  to: string;
  last: string;
  today: string;
  stores: StoreLite[];
  pnl: PnlResult;
  dates: string[];
  dayRev: Lean<{ date: string; storeId: unknown; dt?: number | null }>[];
  closings: Lean<{
    workDate: string;
    storeId: unknown;
    shiftName?: string | null;
    employeeName?: string | null;
    revenue?: Partial<Record<string, number | null>> | null;
    revenueInput?: { cp?: string | null } | null;
    staffTotal?: number | null;
    note?: string | null;
  }>[];
  exps: Lean<{
    date: string;
    category: string;
    amount: number;
    items?: string | null;
    transferNote?: string | null;
    vendor?: string | null;
    paidFrom?: string | null;
    countInCost?: boolean | null;
    createdBy?: string | null;
    note?: string | null;
  }>[];
  rents: Lean<{ storeId?: unknown; name: string; amountPerMonth: number; startMonth: string; endMonth?: string | null }>[];
  atts: Lean<{ storeId: unknown; userId: unknown; workDate: string; roundedHours?: number | null; lateMinutes?: number | null; earlyMinutes?: number | null; status?: string | null; source?: string | null; homeStoreId?: unknown }>[];
  asg: Lean<{ storeId: unknown; userId: unknown; date: string }>[];
};

/** Đọc toàn bộ dữ liệu của 1 tháng cho sheet tổng hợp. */
export async function loadMonthSummary(month: string, storesIn?: StoreLite[]): Promise<MonthSummaryData> {
  const stores = storesIn ?? (await loadStores());
  const { first, last } = monthRange(month);
  const today = localDate(new Date());
  const to = month === today.slice(0, 7) ? today : last;
  const ids = stores.map((s) => s._id);
  if (first > today) return { month, first, to, last, today, stores, pnl: null as unknown as PnlResult, dates: [], dayRev: [], closings: [], exps: [], rents: [], atts: [], asg: [] };
  const [{ pnl, dates }, dayRev, closings, exps, rents, atts, asg] = await Promise.all([
    loadPnl(first, to, stores),
    loadDayRevenue(first, to, stores.map((s) => s._id)),
    ShiftClosing.find({ workDate: { $gte: first, $lte: to }, storeId: { $in: ids } }).sort({ workDate: 1, storeId: 1, createdAt: 1 }).lean(),
    Expense.find({ month }).sort({ date: 1, createdAt: 1 }).lean(),
    FixedCost.find({ startMonth: { $lte: month }, $or: [{ endMonth: null }, { endMonth: "" }, { endMonth: { $gte: month } }] }).lean(),
    Attendance.find({ workDate: { $gte: first, $lte: to }, storeId: { $in: ids } })
      .select("storeId userId workDate roundedHours lateMinutes earlyMinutes status source homeStoreId")
      .lean(),
    ShiftAssignment.find({ date: { $gte: first, $lte: to }, storeId: { $in: ids }, ...APPROVED_SHIFT }).select("storeId userId date").lean(),
  ]);
  return { month, first, to, last, today, stores, pnl, dates, dayRev, closings, exps, rents, atts, asg } as unknown as MonthSummaryData;
}

/** Thêm 1 sheet tổng hợp cho 1 tháng (đọc DB rồi ghi). */
export async function addMonthSummarySheet(wb: ExcelJS.Workbook, month: string, name: string, meta: string, storesIn?: StoreLite[]) {
  writeMonthSummarySheet(wb, await loadMonthSummary(month, storesIn), name, meta);
}

/** Ghi sheet từ dữ liệu đã đọc (thuần – có test). */
export function writeMonthSummarySheet(wb: ExcelJS.Workbook, data: MonthSummaryData, name: string, meta: string) {
  const { month, first, to, last, today, stores, pnl, dates, dayRev, closings, exps, rents, atts, asg } = data;
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  const w = new Writer(ws);
  ws.getColumn(1).width = 38;
  for (let i = 2; i <= 40; i++) ws.getColumn(i).width = 14;

  w.title("TIỆM BƠ SẦU", 14);
  w.title(`TỔNG HỢP THÁNG ${viMonth(month)}${to !== last ? ` (tới ${viDate(to)})` : ""}`);
  w.note(meta);
  w.gap();

  if (first > today) {
    w.note("Tháng chưa bắt đầu – chưa có dữ liệu.");
    return;
  }

  const t = pnl.total;
  const cat = (k: string) => pnl.byCategory[k] ?? 0;

  /* ---------- A. Lãi lỗ tháng ---------- */
  w.section("A. LÃI LỖ THÁNG (cả chuỗi)", 4);
  w.header(["Khoản", "Số tiền", "% doanh thu", "Ghi chú"]);
  const pctRev = (v: number) => (t.revenue ? Math.round((v / t.revenue) * 1000) / 10 : null);
  const line = (label: string, v: number, opt: Parameters<Writer["row"]>[1] = {}, note?: string) => {
    const r = w.row([label, v, pctRev(v), note], { money: [1], ...opt });
    r.getCell(3).numFmt = '0.0"%"';
  };
  line("DOANH THU THẬT (chốt ca)", t.revenue, { bold: true }, "= TK + TM + Shopee/Grab + Chi phí két");
  for (const s of stores) {
    const l = pnl.byStore[s._id];
    line(s.name, l.revenue, { bold: true, indent: 1 });
    line("+ Tài khoản", l.tk, { indent: 3 });
    line("+ Tiền mặt", l.tm, { indent: 3 });
    line("+ Shopee / Grab", l.shopee + l.grab, { indent: 3 });
    line("+ Chi phí két", l.cashbox, { indent: 3 });
    line("DT máy (đối chiếu)", l.machine, { indent: 3, italic: true });
  }
  line("− CHI PHÍ KÉT (chi trong ca)", t.cashbox, { bold: true });
  for (const s of stores) line(s.name, pnl.byStore[s._id].cashbox, { indent: 2 });
  line("− LƯƠNG NV (ước tính)", t.labor, { bold: true }, "giờ công × lương giờ ± thưởng/phạt + phụ cấp");
  for (const s of stores) line(s.name, pnl.byStore[s._id].labor, { indent: 2 });
  line("− CHI PHÍ (admin nhập)", t.shared, { bold: true });
  line("Nguyên liệu", cat("NGUYEN_LIEU"), { indent: 2 });
  line("Điện nước", cat("DIEN_NUOC"), { indent: 2 });
  line("Khác", cat("KHAC"), { indent: 2 });
  if (cat("LUONG")) line("Lương / thưởng (CK, có tick tính)", cat("LUONG"), { indent: 2 });
  line("− CHI PHÍ CỐ ĐỊNH – Mặt bằng", t.fixed, { bold: true });
  for (const s of stores) line(s.name, pnl.byStore[s._id].fixed, { indent: 2 });
  line("− PHÍ SÀN Shopee/Grab", t.platformFee, { bold: true });
  for (const s of stores) line(`${s.name} (Grab ${s.grabFeePct}% · Shopee ${s.shopeeFeePct}%)`, pnl.byStore[s._id].platformFee, { indent: 2 });
  if (t.direct) line("− Chi phí gắn riêng cơ sở (dữ liệu cũ)", t.direct, { bold: true });
  line("TỔNG CHI PHÍ", t.cost, { bold: true, fill: C.section }, "Két + Lương + Chi phí + Mặt bằng + Phí sàn");
  line("= LÃI", t.profit, { bold: true, fill: C.total }, "Doanh thu thật − Tổng chi phí");
  const mr = w.row(["Biên lãi", null, Math.round(margin(t) * 1000) / 10], { bold: true });
  mr.getCell(3).numFmt = '0.0"%"';
  w.gap();

  /* ---------- B. Doanh thu theo ngày ---------- */
  const perStoreCols = ["TK", "TM", "Shopee/Grab", "Két", "DT thật", "DT máy", "Âm/Dương"];
  const wide = 1 + stores.length * perStoreCols.length + 7;
  w.section("B. DOANH THU & LÃI THEO NGÀY", wide);
  // dòng nhóm cơ sở
  const grp = ws.getRow(w.r);
  stores.forEach((s, i) => {
    const c0 = 2 + i * perStoreCols.length;
    ws.mergeCells(w.r, c0, w.r, c0 + perStoreCols.length - 1);
    const c = grp.getCell(c0);
    c.value = s.name;
    c.font = { bold: true, color: { argb: C.headerText } };
    c.alignment = { horizontal: "center" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.header } };
  });
  const cc = 2 + stores.length * perStoreCols.length;
  ws.mergeCells(w.r, cc, w.r, cc + 6);
  grp.getCell(cc).value = "Cả chuỗi";
  grp.getCell(cc).font = { bold: true, color: { argb: C.headerText } };
  grp.getCell(cc).alignment = { horizontal: "center" };
  grp.getCell(cc).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.header } };
  w.r++;
  w.header(["Ngày", ...stores.flatMap(() => perStoreCols), "Doanh thu thật", "Lương", "Chi phí", "Mặt bằng", "Phí sàn", "Két", "LÃI"]);
  const firstDataRow = w.r;
  for (const d of dates) {
    const vals: Cell[] = [`${weekdayVi(d).replace("Thứ ", "T").replace("Chủ Nhật", "CN")} ${dm(d)}`];
    for (const s of stores) {
      const l = pnl.cells[`${d}|${s._id}`];
      const dr = dayRev.find((x) => x.date === d && String(x.storeId) === s._id);
      const diff = dr && dr.dt ? revenueDiff(dr as unknown as Partial<Revenue>) : null;
      vals.push(l.tk || null, l.tm || null, l.shopee + l.grab || null, l.cashbox || null, l.revenue || null, l.machine || null, diff);
    }
    const b = pnl.byDate[d];
    vals.push(b.revenue, b.labor, b.shared, b.fixed, b.platformFee, b.cashbox, b.profit);
    const row = w.row(vals);
    // tô đỏ ô âm/dương lệch
    stores.forEach((_, i) => {
      const cell = row.getCell(2 + i * perStoreCols.length + 6);
      if (typeof cell.value === "number" && cell.value !== 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.warn } };
    });
  }
  const lastDataRow = w.r - 1;
  const tot = w.row(["TỔNG"], { bold: true, fill: C.total });
  for (let col = 2; col < 2 + stores.length * perStoreCols.length + 7; col++) {
    const letter = ws.getColumn(col).letter;
    tot.getCell(col).value = { formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})` };
    tot.getCell(col).numFmt = VND;
    tot.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.total } };
  }
  w.note("Âm/Dương = DT máy − DT thật (TK + TM + Shopee/Grab + Két), chỉ tính các ngày có DT máy. Lương theo ngày là ước tính từ giờ công; mặt bằng chia đều theo ngày.");
  w.gap();

  /* ---------- C. Chi tiết chốt ca ---------- */
  w.section(`C. CHI TIẾT CHỐT CA (${closings.length} lượt)`, 15);
  w.header(["Ngày", "Cơ sở", "Ca", "Thu ngân", "TK", "TM", "Grab", "Shopee", "Thu chi (két)", "Chi tiết thu chi", "DT máy", "Âm/Dương", "Tổng NV ghi", "NV cộng", "Ghi chú"]);
  const storeName = new Map(stores.map((s) => [s._id, s.name]));
  for (const c of closings) {
    const r = (c.revenue ?? {}) as Partial<Revenue>;
    const sum = closingSum(r);
    const diff = r.dt != null ? revenueDiff(r) : null;
    const totalOk = c.staffTotal == null ? "" : c.staffTotal === sum ? "Đúng" : `Sai (đúng ${sum.toLocaleString("vi-VN")})`;
    const row = w.row([
      dm(c.workDate),
      short(storeName.get(String(c.storeId)) ?? ""),
      c.shiftName ?? "",
      c.employeeName ?? "",
      r.tk ?? null,
      r.tm ?? null,
      r.grab ?? null,
      r.shopee ?? null,
      r.cp ?? null,
      c.revenueInput?.cp && /[^\d.,\s]/.test(c.revenueInput.cp) ? c.revenueInput.cp : "",
      r.dt ?? "chưa có",
      diff,
      c.staffTotal ?? null,
      totalOk,
      c.note ?? "",
    ]);
    if (diff) row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.warn } };
    if (totalOk.startsWith("Sai")) row.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.warn } };
  }
  w.gap();

  /* ---------- D. Chi phí admin nhập ---------- */
  w.section(`D. CHI PHÍ ADMIN NHẬP (${exps.length} khoản)`, 9);
  w.header(["Ngày", "Mục", "Số tiền", "Tính vào chi phí", "Nội dung / nội dung CK", "Người nhận / nơi bán", "Nguồn tiền", "Người nhập", "Ghi chú"]);
  const fe = w.r;
  for (const e of exps) {
    w.row([
      dm(e.date),
      CATEGORY_LABEL[e.category] ?? e.category,
      e.amount,
      isCountedExpense(e) ? "Có" : "Không",
      [e.items, e.transferNote].filter(Boolean).join(" · "),
      e.vendor ?? "",
      e.paidFrom === "CASHBOX" ? "Tiền két" : "Chủ / CK",
      e.createdBy ?? "",
      e.note ?? "",
    ]);
  }
  if (exps.length) {
    const r = w.row(["TỔNG (tất cả khoản)", null, null], { bold: true, fill: C.total });
    r.getCell(3).value = { formula: `SUM(C${fe}:C${w.r - 2})` };
    r.getCell(3).numFmt = VND;
    w.row(["Tính vào chi phí", null, exps.filter(isCountedExpense).reduce((s, e) => s + e.amount, 0)], { bold: true });
  }
  w.gap();

  /* ---------- E. Mặt bằng ---------- */
  w.section("E. CHI PHÍ CỐ ĐỊNH – MẶT BẰNG", 4);
  w.header(["Cơ sở", "Tiền thuê / tháng", "Tính trong kỳ", "Áp dụng"]);
  for (const f of rents)
    w.row([
      f.storeId ? (storeName.get(String(f.storeId)) ?? f.name) : `${f.name} (chung)`,
      f.amountPerMonth,
      f.storeId ? (pnl.byStore[String(f.storeId)]?.fixed ?? null) : null,
      `từ ${viMonth(f.startMonth)}${f.endMonth ? ` đến ${viMonth(f.endMonth)}` : ""}`,
    ]);
  if (!rents.length) w.note("Chưa nhập tiền thuê nhà.");
  w.gap();

  /* ---------- F. Chấm công theo cơ sở (không chi tiết nhân viên) ---------- */
  w.section("F. CHẤM CÔNG THEO CƠ SỞ", 11);
  w.header(["Cơ sở", "Số NV đi làm", "Lượt chấm công", "Tổng giờ công", "Ca được xếp", "Ca bỏ (không chấm)", "Đi muộn (lần)", "Về sớm (lần)", "Quên check-out", "Admin chấm hộ", "Giờ NV hỗ trợ từ CS khác"]);
  for (const s of stores) {
    const a = atts.filter((x) => String(x.storeId) === s._id);
    const g = asg.filter((x) => String(x.storeId) === s._id && x.date < today);
    const worked = new Set(a.map((x) => `${x.userId}|${x.workDate}`));
    const r = w.row([
      s.name,
      new Set(a.map((x) => String(x.userId))).size,
      a.length,
      Math.round(a.reduce((sum, x) => sum + (x.roundedHours || 0), 0) * 100) / 100,
      asg.filter((x) => String(x.storeId) === s._id).length,
      g.filter((x) => !worked.has(`${x.userId}|${x.date}`)).length,
      a.filter((x) => (x.lateMinutes || 0) > 0).length,
      a.filter((x) => (x.earlyMinutes || 0) > 0).length,
      a.filter((x) => x.status === "MISSING_CHECKOUT").length,
      a.filter((x) => x.source === "ADMIN_MANUAL").length,
      Math.round(a.filter((x) => x.homeStoreId && String(x.homeStoreId) !== s._id).reduce((sum, x) => sum + (x.roundedHours || 0), 0) * 100) / 100,
    ]);
    r.eachCell((c, i) => {
      if (i > 1) c.numFmt = i === 4 || i === 11 ? "0.00" : "0";
    });
  }
  w.note("Lương NV theo cơ sở nằm ở mục A. File này không liệt kê từng nhân viên – dùng loại báo cáo \"Bảng chấm công\" / \"Bảng lương\" nếu cần chi tiết.");

  ws.views = [{ state: "frozen", ySplit: 0, showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}
