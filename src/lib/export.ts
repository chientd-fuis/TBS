import ExcelJS from "exceljs";
import { Types } from "mongoose";
import { APPROVED_SHIFT, Attendance, BonusPenalty, Payroll, PayrollItem, ShiftAssignment, Store, User } from "./models";
import { decrypt } from "./crypto";
import { formatDuration } from "./calc";
import { daysOfMonth, localTime, monthRange, nextMonth, viDate, viDateTime, viMonth } from "./time";

/* Xuất Excel cho admin – spec 3.8 */

export const EXPORT_TYPES = {
  chamcong: "Bảng chấm công chi tiết + Tổng hợp",
  tonghop: "Tổng hợp chấm công tháng",
  luong: "Bảng lương tháng",
  thuongphat: "Chi tiết thưởng / phạt",
  chuyenkhoan: "Danh sách chuyển khoản",
  nhanvien: "Danh sách nhân viên",
  lichca: "Lịch ca làm việc",
} as const;
export type ExportType = keyof typeof EXPORT_TYPES;

const FILE_KEY: Record<ExportType, string> = {
  chamcong: "ChamCong",
  tonghop: "TongHop",
  luong: "BangLuong",
  thuongphat: "ThuongPhat",
  chuyenkhoan: "ChuyenKhoan",
  nhanvien: "NhanVien",
  lichca: "LichCa",
};

export type ExportFilter = {
  type: ExportType;
  storeIds: string[]; // rỗng = tất cả
  fromMonth: string;
  toMonth: string;
  userIds: string[]; // rỗng = tất cả
  exportedBy: string;
};

const COLORS = {
  header: "FFFCCC18",
  headerText: "FF542424",
  late: "FFFFF1E6",
  missing: "FFFDE8E8",
  manual: "FFECF7EE",
  penalty: "FFD64545",
  bonus: "FF3C9C54",
};
const VND = '#,##0 "₫"';
const HOURS = "0.00";

function months(from: string, to: string) {
  const out: string[] = [];
  for (let m = from; m <= to; m = nextMonth(m)) {
    out.push(m);
    if (out.length > 12) throw new Error("Tối đa 12 tháng mỗi lần xuất");
  }
  return out;
}

function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Sheet";
  let n = base;
  let i = 2;
  while (used.has(n.toLowerCase())) n = `${base.slice(0, 25)} ${i++}`;
  used.add(n.toLowerCase());
  return n;
}

/** Tạo sheet có phần đầu (tên tiệm, báo cáo, kỳ, người xuất) + header vàng/nâu, freeze, autofilter. */
function makeSheet(wb: ExcelJS.Workbook, name: string, title: string, meta: string, columns: { header: string; key: string; width?: number; fmt?: string }[]) {
  const ws = wb.addWorksheet(name);
  ws.getCell("A1").value = "TIỆM BƠ SẦU";
  ws.getCell("A1").font = { bold: true, size: 14, color: { argb: "FF783C3C" } };
  ws.getCell("A2").value = title;
  ws.getCell("A2").font = { bold: true, size: 12 };
  ws.getCell("A3").value = meta;
  ws.getCell("A3").font = { italic: true, size: 9, color: { argb: "FF7A6A5A" } };
  const headerRow = ws.getRow(5);
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: COLORS.headerText } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE4B414" } } };
    ws.getColumn(i + 1).width = c.width ?? Math.max(12, c.header.length + 4);
    if (c.fmt) ws.getColumn(i + 1).numFmt = c.fmt;
  });
  headerRow.height = 22;
  ws.views = [{ state: "frozen", ySplit: 5 }];
  return {
    ws,
    add(values: (string | number | Date | null | undefined | { formula: string })[], fill?: string) {
      const row = ws.addRow(values);
      if (fill) row.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } }));
      return row;
    },
    finish(totals?: Record<number, "SUM">, label = "TỔNG CỘNG") {
      const first = 6;
      const last = ws.rowCount;
      if (last >= first) ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: last, column: columns.length } };
      if (totals && last >= first) {
        const row = ws.addRow([]);
        row.getCell(1).value = label;
        for (const [col] of Object.entries(totals)) {
          const c = Number(col);
          const letter = ws.getColumn(c).letter;
          row.getCell(c).value = { formula: `SUM(${letter}${first}:${letter}${last})` };
        }
        row.font = { bold: true };
        row.eachCell({ includeEmpty: true }, (c) => (c.border = { top: { style: "thin" } }));
      }
    },
  };
}

async function loadScope(f: ExportFilter) {
  const storeQ = f.storeIds.length ? { _id: { $in: f.storeIds.map((s) => new Types.ObjectId(s)) } } : {};
  const stores = await Store.find(storeQ).sort({ name: 1 }).lean();
  const storeIds = stores.map((s) => s._id);
  const userQ: Record<string, unknown> = f.userIds.length
    ? { _id: { $in: f.userIds.map((u) => new Types.ObjectId(u)) } }
    : { storeId: { $in: storeIds }, status: { $in: ["ACTIVE", "INACTIVE"] } };
  const users = await User.find(userQ).sort({ name: 1 }).lean();
  return { stores, storeIds, users, storeName: new Map(stores.map((s) => [String(s._id), s.name])) };
}

export async function buildExport(f: ExportFilter) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Tiệm Bơ Sầu";
  wb.created = new Date();
  const { stores, storeIds, users, storeName } = await loadScope(f);
  const ms = months(f.fromMonth, f.toMonth);
  const period = ms.length === 1 ? `Tháng ${viMonth(ms[0])}` : `Tháng ${viMonth(ms[0])} – ${viMonth(ms[ms.length - 1])}`;
  const storeLabel = f.storeIds.length ? stores.map((s) => s.name).join(", ") : "Tất cả cơ sở";
  const meta = `${storeLabel} · ${period} · Xuất lúc ${viDateTime(new Date())} bởi ${f.exportedBy}`;
  const userIds = users.map((u) => u._id);
  const tzOf = (sid: unknown) => stores.find((s) => String(s._id) === String(sid))?.timezone || "Asia/Ho_Chi_Minh";
  const used = new Set<string>();

  if (f.type === "chamcong" || f.type === "tonghop") {
    // theo cơ sở trả lương (gồm giờ đi hỗ trợ cơ sở khác)
    const atts = await Attendance.find({
      userId: { $in: userIds },
      month: { $in: ms },
      $or: [{ homeStoreId: { $in: storeIds } }, { homeStoreId: { $exists: false }, storeId: { $in: storeIds } }, { homeStoreId: null, storeId: { $in: storeIds } }],
    })
      .sort({ checkInAt: 1 })
      .lean();
    const allStoreNames = new Map((await Store.find().select("name").lean()).map((x) => [String(x._id), x.name]));
    const supportNote = (a: { storeId: unknown; homeStoreId?: unknown }) =>
      a.homeStoreId && String(a.homeStoreId) !== String(a.storeId) ? `Hỗ trợ tại ${allStoreNames.get(String(a.storeId)) ?? "?"}` : "";
    const summary = makeSheet(wb, sheetName("Summary", used), "Tổng hợp chấm công", meta, [
      { header: "Nhân viên", key: "name", width: 24 },
      { header: "Cơ sở", key: "store", width: 18 },
      { header: "Tổng giờ tính công", key: "hours", width: 14, fmt: HOURS },
      { header: "Số ngày công", key: "days", width: 12 },
      { header: "Đi muộn (lần)", key: "late", width: 12 },
      { header: "Về sớm (lần)", key: "early", width: 12 },
      { header: "Quên check-out", key: "missing", width: 13 },
      { header: "Chấm hộ", key: "manual", width: 10 },
    ]);
    for (const u of users) {
      const mine = atts.filter((a) => String(a.userId) === String(u._id));
      const done = mine.filter((a) => a.status === "COMPLETED");
      summary.add([
        u.name || u.email,
        storeName.get(String(u.storeId)) || "",
        Math.round(done.reduce((s, a) => s + (a.roundedHours || 0), 0) * 100) / 100,
        new Set(done.map((a) => a.workDate)).size,
        mine.filter((a) => (a.lateMinutes || 0) > 0).length,
        mine.filter((a) => (a.earlyMinutes || 0) > 0).length,
        mine.filter((a) => a.status === "MISSING_CHECKOUT").length,
        mine.filter((a) => a.source === "ADMIN_MANUAL").length,
      ]);
    }
    summary.finish({ 3: "SUM", 4: "SUM", 5: "SUM", 6: "SUM", 7: "SUM", 8: "SUM" });

    if (f.type === "chamcong") {
      for (const u of users) {
        const mine = atts.filter((a) => String(a.userId) === String(u._id));
        if (!mine.length && f.userIds.length === 0) continue;
        const s = makeSheet(wb, sheetName(u.name || u.email, used), `Bảng chấm công – ${u.name}`, meta, [
          { header: "Ngày", key: "d", width: 12 },
          { header: "Giờ Đến", key: "in", width: 10 },
          { header: "Giờ Về", key: "out", width: 10 },
          { header: "Tổng", key: "t", width: 8, fmt: HOURS },
          { header: "Format", key: "f", width: 8 },
          { header: "Giờ tính công", key: "r", width: 12, fmt: "0.0#" },
          { header: "Ca", key: "ca", width: 22 },
          { header: "Muộn (phút)", key: "late", width: 10 },
          { header: "Sớm (phút)", key: "early", width: 10 },
          { header: "Nguồn", key: "src", width: 12 },
          { header: "Ghi chú", key: "note", width: 40 },
        ]);
        for (const a of mine) {
          const tz = tzOf(a.storeId);
          const fill = a.status === "MISSING_CHECKOUT" ? COLORS.missing : a.lateMinutes || a.earlyMinutes ? COLORS.late : a.source === "ADMIN_MANUAL" ? COLORS.manual : undefined;
          s.add(
            [
              viDate(a.workDate),
              localTime(a.checkInAt, tz),
              a.checkOutAt ? localTime(a.checkOutAt, tz) : "",
              a.totalHours ?? null,
              a.checkOutAt ? formatDuration(a.checkInAt, a.checkOutAt) : "",
              a.roundedHours ?? null,
              a.shiftLabel || (a.outOfShift ? "Ngoài ca" : ""),
              a.lateMinutes || null,
              a.earlyMinutes || null,
              a.source === "ADMIN_MANUAL" ? "Chấm hộ" : a.source === "REQUEST" ? "Điều chỉnh" : "Tự chấm",
              [supportNote(a), a.source === "ADMIN_MANUAL" ? `Chấm hộ bởi ${a.createdByAdminName}: ${a.manualReason}` : "", a.status === "MISSING_CHECKOUT" ? "Quên check-out" : "", a.note || ""]
                .filter(Boolean)
                .join(" | "),
            ],
            fill,
          );
        }
        s.finish({ 4: "SUM", 6: "SUM" });
      }
    }
  }

  if (f.type === "luong" || f.type === "chuyenkhoan") {
    const payrolls = await Payroll.find({ storeId: { $in: storeIds }, month: { $in: ms } }).lean();
    const items = await PayrollItem.find({ payrollId: { $in: payrolls.map((p) => p._id) }, userId: { $in: userIds } }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const statusOf = (pid: unknown) => {
      const st = payrolls.find((p) => String(p._id) === String(pid))?.status;
      return st === "PAID" ? "Đã trả" : st === "PUBLISHED" ? "Đã công bố" : "Nháp";
    };
    if (f.type === "luong") {
      const s = makeSheet(wb, "Bảng lương", "Bảng lương", meta, [
        { header: "Tháng", key: "m", width: 9 },
        { header: "Nhân viên", key: "n", width: 24 },
        { header: "Cơ sở", key: "s", width: 16 },
        { header: "Giờ tính công", key: "h", width: 12, fmt: HOURS },
        { header: "Lương giờ", key: "w", width: 12, fmt: VND },
        { header: "Lương cơ bản", key: "b", width: 14, fmt: VND },
        { header: "Phụ cấp", key: "a", width: 12, fmt: VND },
        { header: "Tổng thưởng", key: "tb", width: 13, fmt: VND },
        { header: "Tổng phạt", key: "tp", width: 13, fmt: VND },
        { header: "Tạm ứng", key: "ad", width: 12, fmt: VND },
        { header: "Thực nhận", key: "net", width: 15, fmt: VND },
        { header: "Trạng thái", key: "st", width: 12 },
      ]);
      for (const i of items) {
        const u = userMap.get(String(i.userId));
        const row = s.add([viMonth(i.month), u?.name || "", storeName.get(String(i.storeId)) || "", i.totalHours, i.hourlyWage, i.basePay, i.allowance, i.totalBonus, i.totalPenalty, i.advance, i.netPay, statusOf(i.payrollId)]);
        row.getCell(8).font = { color: { argb: COLORS.bonus } };
        row.getCell(9).font = { color: { argb: COLORS.penalty } };
        row.getCell(11).font = { bold: true };
      }
      s.finish({ 4: "SUM", 6: "SUM", 7: "SUM", 8: "SUM", 9: "SUM", 10: "SUM", 11: "SUM" });
    } else {
      const s = makeSheet(wb, "Chuyển khoản", "Danh sách chuyển khoản", meta, [
        { header: "STT", key: "i", width: 6 },
        { header: "Họ tên", key: "n", width: 24 },
        { header: "Ngân hàng", key: "b", width: 16 },
        { header: "Số tài khoản", key: "acc", width: 20 },
        { header: "Số tiền", key: "amt", width: 15, fmt: VND },
        { header: "Nội dung chuyển khoản", key: "c", width: 40 },
      ]);
      let idx = 1;
      for (const i of items.filter((x) => x.netPay > 0)) {
        const u = userMap.get(String(i.userId));
        const row = s.add([idx++, u?.name || "", u?.bankName || "", decrypt(u?.bankAccountEnc), i.netPay, `TBS luong ${viMonth(i.month)} - ${(u?.name || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")}`]);
        row.getCell(4).numFmt = "@";
      }
      s.finish({ 5: "SUM" });
    }
  }

  if (f.type === "thuongphat") {
    const bps = await BonusPenalty.find({ storeId: { $in: storeIds }, userId: { $in: userIds }, month: { $in: ms } }).sort({ date: 1 }).lean();
    const userMap = new Map(users.map((u) => [String(u._id), u]));
    const s = makeSheet(wb, "Thưởng phạt", "Chi tiết thưởng / phạt", meta, [
      { header: "Ngày", key: "d", width: 12 },
      { header: "Nhân viên", key: "n", width: 24 },
      { header: "Cơ sở", key: "s", width: 16 },
      { header: "Loại", key: "k", width: 9 },
      { header: "Số tiền", key: "a", width: 14, fmt: VND },
      { header: "Nội dung", key: "c", width: 40 },
      { header: "Người nhập", key: "by", width: 18 },
    ]);
    for (const b of bps) {
      const row = s.add([viDate(b.date), userMap.get(String(b.userId))?.name || "", storeName.get(String(b.storeId)) || "", b.kind === "BONUS" ? "Thưởng" : "Phạt", b.kind === "BONUS" ? b.amountVnd : -b.amountVnd, b.content, b.createdBy || ""]);
      row.getCell(5).font = { color: { argb: b.kind === "BONUS" ? COLORS.bonus : COLORS.penalty } };
    }
    s.finish({ 5: "SUM" }, "TỔNG (thưởng − phạt)");
  }

  if (f.type === "nhanvien") {
    const s = makeSheet(wb, "Nhân viên", "Danh sách nhân viên", meta, [
      { header: "Họ tên", key: "n", width: 24 },
      { header: "Email", key: "e", width: 28 },
      { header: "SĐT", key: "p", width: 14 },
      { header: "Ngân hàng", key: "b", width: 16 },
      { header: "Số tài khoản", key: "acc", width: 20 },
      { header: "Lương giờ", key: "w", width: 12, fmt: VND },
      { header: "Cơ sở", key: "s", width: 16 },
      { header: "Trạng thái", key: "st", width: 12 },
      { header: "Ngày vào làm", key: "j", width: 13 },
    ]);
    for (const u of users) {
      const row = s.add([u.name, u.email, u.phone, u.bankName, decrypt(u.bankAccountEnc), u.hourlyWage, storeName.get(String(u.storeId)) || "", u.status === "ACTIVE" ? "Đang làm" : "Nghỉ việc", u.joinedAt ? viDateTime(u.joinedAt).slice(0, 10) : ""]);
      row.getCell(3).numFmt = "@";
      row.getCell(5).numFmt = "@";
    }
    s.finish();
  }

  if (f.type === "lichca") {
    for (const m of ms) {
      const { first, last } = monthRange(m);
      const days = daysOfMonth(m);
      // gồm cả ca đi hỗ trợ cơ sở khác của nhân viên
      const list = await ShiftAssignment.find({ userId: { $in: userIds }, date: { $gte: first, $lte: last }, ...APPROVED_SHIFT }).lean();
      const otherStoreNames = new Map((await Store.find().select("name").lean()).map((x) => [String(x._id), x.name]));
      const s = makeSheet(wb, sheetName(`Lịch ca ${m}`, used), `Lịch ca tháng ${viMonth(m)}`, meta, [
        { header: "Nhân viên", key: "n", width: 22 },
        ...days.map((d) => ({ header: d.slice(8, 10), key: d, width: 11 })),
      ]);
      for (const u of users) {
        const mine = list.filter((a) => String(a.userId) === String(u._id));
        if (!mine.length) continue;
        const row = s.add([u.name, ...days.map((d) => mine.filter((a) => a.date === d).map((a) => `${a.shiftName} ${a.startTime}-${a.endTime}${storeIds.some((x) => String(x) === String(a.storeId)) ? "" : ` (HT ${otherStoreNames.get(String(a.storeId)) ?? ""})`}`).join("\n") || null)]);
        row.alignment = { wrapText: true, vertical: "top" };
      }
      s.finish();
    }
  }

  if (wb.worksheets.length === 0) wb.addWorksheet("Trống").getCell("A1").value = "Không có dữ liệu";

  const storePart = f.storeIds.length === 1 ? (stores[0]?.name || "").replace(/^TBS\s*/i, "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").replace(/\s+/g, "") : "TatCa";
  const monthPart = ms.length === 1 ? ms[0] : `${ms[0]}_${ms[ms.length - 1]}`;
  const fileName = `TBS_${FILE_KEY[f.type]}_${storePart}_${monthPart}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  return { buffer, fileName };
}
