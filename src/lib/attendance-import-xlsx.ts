import ExcelJS from "exceljs";
import { parseSheetGrid, type GridCell, type ParsedSheet } from "./attendance-import";
import { daysOfMonth } from "./time";

/** Đọc file Excel chấm công: mỗi sheet 1 nhân viên. Sheet không đúng mẫu (VD Hướng dẫn) bị bỏ qua. */
/** dayStart: giờ bắt đầu ca đầu tiên của cơ sở – dùng tự điền giờ khi file chỉ có số giờ (mẫu 2, cột F) */
export async function readAttendanceWorkbook(buf: ArrayBuffer, opts: { dayStart?: string } = {}): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    const grid: GridCell[][] = [];
    const rows = Math.min(ws.rowCount, 2000);
    const cols = Math.min(ws.columnCount, 30);
    for (let r = 1; r <= rows; r++) {
      const row: GridCell[] = [];
      for (let c = 1; c <= cols; c++) {
        const cell = ws.getCell(r, c);
        if (cell.isMerged) row.push({ v: cell.master.value, m: cell.master.address });
        else row.push({ v: cell.value });
      }
      grid.push(row);
    }
    const p = parseSheetGrid(grid, ws.name, opts);
    if (p) out.push(p);
  });
  return out;
}

const HEAD = ["Ngày", "Thời gian", "Hình thức chấm công", "Đi trễ", "Về sớm", "Tổng thời gian", "Ca làm việc", "Tiền công"];
const safeSheet = (s: string) => s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);

/** File mẫu: sheet Hướng dẫn + mỗi nhân viên 1 sheet, mỗi ngày 2 lượt (4 dòng: vào/ra). */
export async function buildAttendanceTemplate(names: string[], month: string, storeName: string) {
  const wb = new ExcelJS.Workbook();
  const guide = wb.addWorksheet("Huong dan");
  guide.getColumn(1).width = 110;
  [
    `MẪU NHẬP CHẤM CÔNG – ${storeName} – tháng ${month.slice(5)}/${month.slice(0, 4)}`,
    "",
    "• Mỗi nhân viên 1 sheet (tên sheet tuỳ ý, VD 1_Nga Le). Dòng tiêu đề “Thời Gian Chấm Công - <Tên>” dùng để tự gợi ý nhân viên.",
    "• Mỗi lượt làm = 2 dòng: dòng 1 giờ vào, dòng 2 giờ ra (cột Thời gian, dạng 08:12). Cột Ca làm việc gộp 2 dòng của lượt.",
    "• Thiếu giờ ra: để trống dòng 2 và ghi “Chưa kết thúc chấm công” ở cột Hình thức chấm công.",
    "• Các cột Đi trễ / Về sớm / Tổng thời gian / Tiền công không cần nhập – hệ thống tự tính lại theo ca đã xếp.",
    "• Có thể import thẳng file xuất từ máy / app chấm công cũ nếu cùng dạng cột như trên.",
  ].forEach((t, i) => {
    const c = guide.getCell(i + 1, 1);
    c.value = t;
    if (i === 0) c.font = { bold: true, size: 14 };
  });

  const days = daysOfMonth(month);
  const last = days[days.length - 1];
  const vd = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  const border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } } as const;
  names.forEach((name, i) => {
    const ws = wb.addWorksheet(safeSheet(`${i + 1}_${name}`));
    [12, 10, 26, 10, 10, 14, 14, 12].forEach((w, k) => (ws.getColumn(k + 1).width = w));
    ws.mergeCells("A2:H2");
    ws.getCell("A2").value = `Thời Gian Chấm Công - ${name}`;
    ws.getCell("A2").font = { bold: true, size: 13, color: { argb: "FF9A2A2A" } };
    ws.mergeCells("A3:H3");
    ws.getCell("A3").value = `Từ ${vd(days[0])} đến ${vd(last)}`;
    for (const a of ["A2", "A3"]) {
      ws.getCell(a).alignment = { horizontal: "right" };
      ws.getCell(a).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF200" } };
    }
    const h = ws.getRow(5);
    HEAD.forEach((t, k) => {
      const c = h.getCell(k + 1);
      c.value = t;
      c.font = { bold: true };
      c.alignment = { horizontal: "center" };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFB7E1A1" } };
      c.border = border;
    });
    let r = 6;
    for (const d of days) {
      ws.mergeCells(r, 1, r + 3, 1);
      const dc = ws.getCell(r, 1);
      dc.value = vd(d);
      dc.alignment = { vertical: "middle", horizontal: "center" };
      for (const p of [r, r + 2]) for (const k of [4, 5, 6, 7, 8]) ws.mergeCells(p, k, p + 1, k);
      for (let rr = r; rr < r + 4; rr++) for (let k = 1; k <= 8; k++) ws.getCell(rr, k).border = border;
      r += 4;
    }
    ws.views = [{ state: "frozen", ySplit: 5 }];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
