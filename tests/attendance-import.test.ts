import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { expandBulk, matchStaff, matchTemplate, normalizeAiAttendance, parseDate, parseTime } from "../src/lib/attendance-import";
import { buildAttendanceTemplate, readAttendanceWorkbook } from "../src/lib/attendance-import-xlsx";

test("parseTime / parseDate", () => {
  assert.equal(parseTime("08:12"), "08:12");
  assert.equal(parseTime("8h5"), "08:05");
  assert.equal(parseTime(0.5), "12:00");
  assert.equal(parseTime(new Date(Date.UTC(1899, 11, 30, 23, 24))), "23:24");
  assert.equal(parseTime("Wifi"), null);
  assert.equal(parseDate("01/11/2026"), "2026-11-01");
  assert.equal(parseDate("8/11", "2026-11"), "2026-11-08");
  assert.equal(parseDate(new Date(Date.UTC(2026, 10, 3))), "2026-11-03");
  assert.equal(parseDate(46329), "2026-11-03");
  assert.equal(parseDate("31/02/2026"), null);
});

/** Dựng sheet giống file IN_OUT_T11 (ô gộp Ngày, Ca làm việc gộp 2 dòng). */
async function sample() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("1_Nga Le");
  ws.mergeCells("A2:H2");
  ws.getCell("A2").value = "Thời Gian Chấm Công - Nga Le";
  ws.mergeCells("A3:H3");
  ws.getCell("A3").value = "Từ 01/11/2026 đến 30/11/2026";
  ws.getRow(5).values = ["Ngày", "Thời gian", "Hình thức chấm công", "Đi trễ", "Về sớm", "Tổng thời gian", "Ca làm việc", "Tiền công"];
  const day = (r0: number, date: string, rows: [string | null, string][], shifts: string[]) => {
    ws.mergeCells(r0, 1, r0 + rows.length - 1, 1);
    ws.getCell(r0, 1).value = date;
    rows.forEach(([t, m], i) => {
      if (t) ws.getCell(r0 + i, 2).value = t;
      ws.getCell(r0 + i, 3).value = m;
    });
    shifts.forEach((s, i) => {
      ws.mergeCells(r0 + i * 2, 7, r0 + i * 2 + 1, 7);
      ws.getCell(r0 + i * 2, 7).value = s;
    });
  };
  const W = "Wifi: Tiem Bo Sau_2.4G";
  day(6, "01/11/2026", [["08:12", W], ["23:24", W]], ["Ca Sáng"]);
  day(8, "02/11/2026", [["08:10", W], ["12:59", W], ["13:00", W], ["18:11", W], ["18:12", W], ["23:12", W]], ["Ca Sáng", "Ca Chiều", "Ca Tối"]);
  day(14, "07/11/2026", [["08:08", W], ["13:02", W], ["13:03", W], [null, "Chưa kết thúc chấm công"]], ["Ca Sáng", "Ca Chiều"]);
  ws.getCell(18, 1).value = "08/11/2026";
  wb.addWorksheet("2_huu _uc").getCell("A1").value = "trống";
  return wb.xlsx.writeBuffer();
}

test("đọc file chấm công dạng IN_OUT", async () => {
  const sheets = await readAttendanceWorkbook((await sample()) as ArrayBuffer);
  assert.equal(sheets.length, 1);
  const s = sheets[0];
  assert.equal(s.name, "Nga Le");
  assert.deepEqual(
    s.sessions.map((x) => [x.date, x.inTime, x.outTime, x.shift]),
    [
      ["2026-11-01", "08:12", "23:24", "Ca Sáng"],
      ["2026-11-02", "08:10", "12:59", "Ca Sáng"],
      ["2026-11-02", "13:00", "18:11", "Ca Chiều"],
      ["2026-11-02", "18:12", "23:12", "Ca Tối"],
      ["2026-11-07", "08:08", "13:02", "Ca Sáng"],
      ["2026-11-07", "13:03", null, "Ca Chiều"],
    ],
  );
  assert.equal(s.sessions[0].warn, undefined); // 08:12–23:24 ≈ 15 tiếng: bình thường (ngưỡng cảnh báo 16 tiếng)
  assert.equal(s.sessions[5].warn, "Thiếu giờ ra");
});

test("không gộp ô: ghép lần lượt 2 dòng", async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("An");
  ws.getRow(1).values = ["Ngày", "Thời gian"];
  ws.getRow(2).values = ["3/11/2026", "08:00"];
  ws.getRow(3).values = [null, "12:00"];
  ws.getRow(4).values = [null, "13:00"];
  ws.getRow(5).values = ["4/11/2026", "18:00"];
  const [s] = await readAttendanceWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  assert.equal(s.name, "An");
  assert.deepEqual(s.sessions.map((x) => [x.date, x.inTime, x.outTime]), [["2026-11-03", "08:00", "12:00"], ["2026-11-03", "13:00", null], ["2026-11-04", "18:00", null]]);
});

test("file mẫu đọc lại được", async () => {
  const buf = await buildAttendanceTemplate(["Nga Le", "Hữu Úc"], "2026-11", "TBS Văn Phú");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("1_Nga Le")!;
  ws.getCell("B6").value = "08:00";
  ws.getCell("B7").value = "12:30";
  ws.getCell("G6").value = "Ca Sáng";
  const sheets = await readAttendanceWorkbook((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  assert.deepEqual(sheets.map((s) => s.name), ["Nga Le", "Hữu Úc"]);
  assert.deepEqual(sheets[0].sessions, [{ date: "2026-11-01", inTime: "08:00", outTime: "12:30", shift: "Ca Sáng" }]);
  assert.equal(sheets[1].sessions.length, 0);
});

test("gợi ý nhân viên theo tên", () => {
  const staff = [{ id: "1", name: "Lê Thị Nga" }, { id: "2", name: "Nguyễn Tiến Phong" }, { id: "3", name: "Quỳnh Lò" }];
  assert.equal(matchStaff("Nga Le", staff)?.id, "1");
  assert.equal(matchStaff("Nguyen Tien Phong", staff)?.id, "2");
  assert.equal(matchStaff("quynh lo", staff)?.id, "3");
  assert.equal(matchStaff("Huu Uc", staff), null);
});

test("sinh lượt theo ca / giờ tự nhập", () => {
  const tpl = [{ name: "Ca Chiều", startTime: "13:00", endTime: "18:00" }, { name: "Ca Sáng", startTime: "08:00", endTime: "13:00" }];
  assert.deepEqual(expandBulk({ dates: ["2026-11-02", "2026-11-01"], shifts: tpl }).map((s) => `${s.date} ${s.inTime}-${s.outTime}`), [
    "2026-11-01 08:00-13:00",
    "2026-11-01 13:00-18:00",
    "2026-11-02 08:00-13:00",
    "2026-11-02 13:00-18:00",
  ]);
  assert.deepEqual(expandBulk({ dates: ["2026-11-01"], inTime: "07:30", outTime: "" }), [{ date: "2026-11-01", inTime: "07:30", outTime: null }]);
  assert.equal(matchTemplate("sáng", tpl)?.name, "Ca Sáng");
});

test("AI đọc ảnh: thiếu giờ → lấy giờ ca, thiếu năm → năm tháng chọn", () => {
  const tpl = [{ name: "Ca Tối", startTime: "18:00", endTime: "23:00" }];
  const r = normalizeAiAttendance(
    { records: [{ employee_name: "Nga", date: "5/11", check_in: null, check_out: null, shift: "tối" }, { employee_name: "Nga", date: "4/11", check_in: "08:05", check_out: "13:00" }, { date: "x" }] },
    "2026-11",
    tpl,
  );
  assert.deepEqual(r.map((x) => [x.date, x.inTime, x.outTime, x.shift ?? null]), [["2026-11-04", "08:05", "13:00", null], ["2026-11-05", "18:00", "23:00", "Ca Tối"]]);
});

test("import Excel mẫu 2: mỗi dòng 1 lượt (Ngày | Giờ Đến | Giờ Về), tên sheet = tên nhân viên", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Le_Thi_Nga");
  ws.getRow(2).values = ["Ngày", "Giờ Đến", "Giờ Về", "Tổng", "Format", ""];
  ws.addRow(["31/10/2026", "07:55:37", "23:28:03", 15.54, "15:32", 15.5]);
  ws.addRow(["01/11/2026", "08:00:45", "22:56:28", 14.93, "14:55", 15]);
  ws.addRow(["01/11/2026", 0.75, 0.9375, 4.5]); // giờ dạng số (Excel / Google Sheet)
  ws.addRow(["02/11/2026", "", "", 5]); // không có giờ → bỏ qua
  ws.addRow(["03/11/2026", "18:06:09", ""]); // thiếu giờ về
  const buf = await wb.xlsx.writeBuffer();
  const [s] = await readAttendanceWorkbook(buf as ArrayBuffer);
  assert.equal(s.name, "Le Thi Nga");
  assert.deepEqual(
    s.sessions.map((x) => [x.date, x.inTime, x.outTime]),
    [
      ["2026-10-31", "07:55", "23:28"],
      ["2026-11-01", "08:00", "22:56"],
      ["2026-11-01", "18:00", "22:30"],
      ["2026-11-03", "18:06", null],
    ],
  );
  assert.equal(s.sessions[0].warn, undefined); // 15,5 tiếng: bình thường (ngưỡng 16 tiếng)
  assert.equal(s.sessions[3].warn, "Thiếu giờ ra");
  assert.equal(matchStaff(s.name, [{ id: "1", name: "Lê Thị Nga" }, { id: "2", name: "Trần Lâm" }])?.id, "1");
});
