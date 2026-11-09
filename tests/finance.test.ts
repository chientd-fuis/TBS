import test from "node:test";
import assert from "node:assert/strict";
import { allocate, computePnl, formatExpenseCaption, normalizeBill, revenueDeviation, shareMap } from "../src/lib/finance";

test("chia chi phí chung theo doanh thu / đều / tự đặt, tổng khớp", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(shareMap(ids, "REVENUE", { a: 600, b: 300, c: 100 }), { a: 0.6, b: 0.3, c: 0.1 });
  const eq = shareMap(ids, "REVENUE", {}); // chưa có doanh thu → chia đều
  assert.ok(Math.abs(eq.a - 1 / 3) < 1e-9);
  assert.deepEqual(shareMap(ids, "CUSTOM", {}, [{ storeId: "a", pct: 50 }, { storeId: "b", pct: 50 }]), { a: 0.5, b: 0.5, c: 0 });
  const parts = allocate(100_001, shareMap(ids, "EQUAL", {}));
  assert.equal(Object.values(parts).reduce((x, y) => x + y, 0), 100_001);
});

test("lãi lỗ chuỗi: lãi gộp cơ sở − chi phí chung; theo cơ sở là tuỳ chọn phân bổ", () => {
  const r = computePnl({
    storeIds: ["a", "b"],
    dates: ["2026-11-01", "2026-11-02"],
    revenue: [
      // thực thu a = 1.000 + 1.000 + 1.000 (grab) + 50 (két) = 3.050.000
      { storeId: "a", date: "2026-11-01", dt: 3_000_000, tm: 1_000_000, tk: 1_000_000, cp: 50_000, grab: 1_000_000, shopee: 0 },
      { storeId: "b", date: "2026-11-01", dt: null, tm: 400_000, tk: 600_000, cp: 0, grab: 0, shopee: 0 },
    ],
    expenses: [
      { date: "2026-11-01", amount: 400_000, scope: "SHARED", category: "NGUYEN_LIEU" },
      { date: "2026-11-01", amount: 200_000, scope: "SHARED", category: "BAO_BI" },
      { date: "2026-11-01", amount: 3_000_000, scope: "SHARED", category: "LUONG" }, // lương: mặc định không tính
      { date: "2026-11-01", amount: 30_000, scope: "SHARED", paidFrom: "CASHBOX" }, // tiền két: không cộng lại
    ],
    fixed: [{ amountPerMonth: 3_000_000, scope: "STORE", storeId: "b", startMonth: "2026-01", category: "MAT_BANG" }],
    labor: [{ storeId: "a", date: "2026-11-01", amount: 500_000 }],
    fees: { a: { grab: 25, shopee: 0 } },
  });
  const a = r.byStore.a;
  assert.equal(a.revenue, 3_050_000); // DT thật = TK + TM + Grab + Shopee + két
  assert.equal(a.cashbox, 50_000); // két là chi phí
  assert.equal(a.machine, 3_000_000);
  assert.equal(a.contribution, 3_050_000 - 50_000 - 250_000 - 500_000);
  assert.equal(a.shared, 0);
  assert.equal(r.byStore.b.fixed, 200_000); // mặt bằng 3tr / 30 ngày × 2 ngày
  assert.equal(r.total.shared, 600_000);
  assert.equal(r.byDate["2026-11-01"].shared, 600_000);
  // Lãi = DT thật − két − lương − chi phí admin − mặt bằng − phí sàn (két cộng vào DT rồi trừ ra → lãi không đổi)
  assert.equal(r.total.revenue, 4_050_000);
  assert.equal(r.total.profit, 4_050_000 - 50_000 - 500_000 - 600_000 - 200_000 - 250_000);
  assert.equal(r.byCategory.NGUYEN_LIEU, 400_000);
  assert.equal(r.byCategory.KHAC, 200_000); // BAO_BI (mục cũ) gộp vào Khác
  assert.equal(r.byCategory.LUONG, undefined);
  assert.equal(r.allocByStore.a + r.allocByStore.b, 600_000);
  assert.equal(r.allocByStore.b, Math.round((600_000 * 1_000_000) / 4_050_000));
  // biểu đồ tỷ lệ chi phí / doanh thu: nhóm chi phí cả chuỗi, tổng = tổng chi phí
  assert.deepEqual(r.costGroups, { LUONG: 500_000, MAT_BANG: 200_000, NGUYEN_LIEU: 400_000, KET: 50_000, DIEN_NUOC: 0, KHAC: 200_000 + 250_000 });
  assert.equal(Object.values(r.costGroups).reduce((x, y) => x + y, 0), r.total.cost);
});

test("đọc bill + bất thường doanh thu", () => {
  assert.deepEqual(normalizeBill({ amount: "1.250.000", date: "05/11/2026", vendor: "Bách hoá XANH", items: "Sữa đặc x5", category: "NGUYEN_LIEU" }), {
    amount: 1_250_000,
    date: "2026-11-05",
    vendor: "Bách hoá XANH",
    items: "Sữa đặc x5",
    category: "NGUYEN_LIEU",
  });
  assert.deepEqual(normalizeBill({ amount: null, category: "LẠ" }), {});
  assert.equal(revenueDeviation(600, [1000, 1000, 1000]), -0.4);
  assert.equal(revenueDeviation(900, [1000, 1000]), null);
  assert.equal(revenueDeviation(500, [1000]), null); // ít dữ liệu
});

test("caption chi phí gửi nhóm Quản lý doanh thu", () => {
  const c = formatExpenseCaption({
    date: "2026-11-05",
    weekday: "Thứ 5",
    amount: 1_250_000,
    category: "NGUYEN_LIEU",
    allocation: "REVENUE",
    vendor: "Bách hoá XANH",
    items: "Sữa đặc x5",
    paidFrom: "OWNER",
    by: "Chủ (a@b.c)",
  });
  assert.match(c, /^💸 CHI PHÍ\n📅 Ngày: 05\/11\/2026 \(Thứ 5\)\n💰 Số tiền: 1\.250\.000 đ/);
  assert.match(c, /Chi phí chung chuỗi/);
  assert.match(c, /Nguồn tiền: Chủ trả/);
  assert.match(formatExpenseCaption({ date: "2026-11-05", weekday: "Thứ 5", amount: 1, category: "KHAC", storeName: "TBS Văn Phú", by: "x", deleted: true }), /^🗑 ĐÃ XOÁ CHI PHÍ[\s\S]*Gắn riêng cơ sở: Văn Phú/);
});

test("nhận diện chuyển lương nhân viên, lương không cộng vào chi phí", async () => {
  const { detectSalary } = await import("../src/lib/finance");
  const staff = ["Nguyễn Thị Lan", "Trần Văn Nam"];
  assert.deepEqual(detectSalary({ vendor: "NGUYEN THI LAN", transferNote: "chuyen tien" }, staff), { text: 'Người nhận "NGUYEN THI LAN" trùng tên nhân viên Nguyễn Thị Lan', strong: false });
  assert.match(detectSalary({ vendor: "Le Hoa", transferNote: "TBS ung luong T11" }, staff)!.text, /ung luong/);
  assert.equal(detectSalary({ vendor: "Le Hoa", transferNote: "TBS ung luong T11" }, staff)!.strong, true);
  assert.equal(detectSalary({ vendor: "CONG TY SUA VINAMILK", transferNote: "thanh toan don 123" }, staff), null);
  assert.equal(detectSalary({ vendor: "Lan", transferNote: "" }, staff), null); // 1 chữ → không đủ để khớp
  const r = computePnl({
    storeIds: ["a"], dates: ["2026-11-01"], revenue: [], fixed: [], labor: [], fees: {},
    expenses: [{ date: "2026-11-01", amount: 5_000_000, scope: "SHARED", category: "LUONG" }],
  });
  assert.equal(r.total.cost, 0);
});

test("sao kê nhiều giao dịch: chỉ lấy tiền ra, chuẩn hoá, caption gộp", async () => {
  const { normalizeStatement, txKey, formatExpenseBatchCaption } = await import("../src/lib/finance");
  const txs = normalizeStatement(
    {
      transactions: [
        { direction: "OUT", amount: "-1.250.000", date: "07/11/2026", time: "9:05", recipient: "CONG TY SUA ABC", transfer_note: "TBS nhap sua", purpose: "Nhập sữa", category: "NGUYEN_LIEU" },
        { direction: "IN", amount: 5_000_000, date: "2026-11-07", recipient: "GRAB" },
        { direction: "OUT", amount: 3_500_000, date: "2026-11-06", recipient: "NGUYEN THI LAN", transfer_note: "luong T10", category: "LUONG" },
        { direction: "OUT", amount: null },
      ],
    },
    "2026-11-08",
  );
  assert.equal(txs.length, 2);
  assert.deepEqual(txs[0], { amount: 1_250_000, date: "2026-11-07", time: "09:05", recipient: "CONG TY SUA ABC", transferNote: "TBS nhap sua", purpose: "Nhập sữa", category: "NGUYEN_LIEU" });
  assert.equal(txKey(txs[0]), txKey({ ...txs[0] }));
  const cap = formatExpenseBatchCaption(
    [
      { date: "2026-11-07", amount: 1_250_000, category: "NGUYEN_LIEU", target: "Geleximco", content: "TBS nhap sua", countInCost: true },
      { date: "2026-11-06", amount: 3_500_000, category: "LUONG", target: "", content: "luong T10", countInCost: false },
    ],
    "Chủ",
  );
  assert.match(cap, /^💸 CHI PHÍ – 2 khoản · tính vào chi phí 1\.250\.000 đ/);
  assert.match(cap, /2\. 06\/11 · 3\.500\.000 · .* – luong T10 \(không tính chi phí\)/);
  assert.match(cap, /1 khoản chỉ lưu chứng từ/);
});

test("checkbox tính vào chi phí ghi đè mặc định theo mục", async () => {
  const { isCountedExpense, computePnl } = await import("../src/lib/finance");
  assert.equal(isCountedExpense({ category: "LUONG" }), false);
  assert.equal(isCountedExpense({ category: "LUONG", countInCost: true }), true);
  assert.equal(isCountedExpense({ category: "KHAC", countInCost: false }), false);
  assert.equal(isCountedExpense({ category: "KHAC", countInCost: true, paidFrom: "CASHBOX" }), false);
  const r = computePnl({
    storeIds: ["a"], dates: ["2026-11-01"], revenue: [], fixed: [], labor: [], fees: {},
    expenses: [{ date: "2026-11-01", amount: 2_000_000, scope: "SHARED", category: "LUONG", countInCost: true }],
  });
  assert.equal(r.total.cost, 2_000_000);
});

test("xuất tổng hợp tháng: 1 sheet / tháng có lãi lỗ, doanh thu ngày, chốt ca, chi phí", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { writeMonthSummarySheet } = await import("../src/lib/export-summary");
  const stores = [{ _id: "a", name: "TBS Geleximco", short: "Geleximco", grabFeePct: 0, shopeeFeePct: 0 }];
  const dates = ["2026-10-01", "2026-10-02"];
  const pnl = computePnl({
    storeIds: ["a"], dates, fees: {}, fixed: [], labor: [{ storeId: "a", date: "2026-10-01", amount: 500_000 }],
    revenue: [{ storeId: "a", date: "2026-10-01", dt: 3_000_000, tm: 1_000_000, tk: 2_000_000, cp: 0, grab: 0, shopee: 0 }],
    expenses: [{ date: "2026-10-02", amount: 400_000, scope: "SHARED", category: "NGUYEN_LIEU" }],
  });
  const wb = new ExcelJS.Workbook();
  writeMonthSummarySheet(
    wb,
    { month: "2026-10", first: "2026-10-01", to: "2026-10-02", last: "2026-10-31", today: "2026-11-08", stores, pnl, dates, dayRev: [], closings: [], exps: [{ date: "2026-10-02", category: "NGUYEN_LIEU", amount: 400_000 }], rents: [], atts: [], asg: [] } as never,
    "T10-2026",
    "test",
  );
  const ws = wb.getWorksheet("T10-2026")!;
  const rows: unknown[][] = [];
  ws.eachRow((r) => rows.push((r.values as unknown[]).slice(1)));
  const find = (label: string) => rows.find((r) => r[0] === label);
  assert.equal(find("DOANH THU THẬT (chốt ca)")?.[1], 3_000_000);
  assert.equal(find("= LÃI")?.[1], 3_000_000 - 500_000 - 400_000);
  assert.ok(rows.some((r) => r[0] === "C. CHI TIẾT CHỐT CA (0 lượt)"));
  assert.ok(rows.some((r) => r[0] === "D. CHI PHÍ ADMIN NHẬP (1 khoản)"));
  assert.ok(rows.some((r) => r[0] === "F. CHẤM CÔNG THEO CƠ SỞ"));
});

test("tổng Doanh thu theo ngày khớp doanh thu tính lãi (cùng nguồn, luỹ kế lấy ca Tối)", async () => {
  const { dayRevenueFromClosings } = await import("../src/lib/revenue");
  const c = (storeId: string, workDate: string, shiftName: string, tm: number, tk: number, grab = 0, shopee = 0, cp = 0) => ({ storeId, workDate, shiftName, createdAt: `${workDate}T10:00:00Z`, revenue: { tm, tk, grab, shopee, cp, dt: null } });
  const closings = [
    c("a", "2026-11-01", "Sáng", 800_000, 1_200_000, 300_000),
    c("a", "2026-11-01", "Chiều", 1_500_000, 2_500_000, 600_000, 100_000),
    c("a", "2026-11-01", "Tối", 2_300_000, 4_100_000, 900_000, 200_000, 120_000),
    c("b", "2026-11-01", "Sáng", 600_000, 900_000), // chưa chốt Tối → tạm tính ca Sáng
    c("a", "2026-11-02", "Tối", 2_000_000, 3_000_000),
  ];
  const rows = dayRevenueFromClosings(closings);
  const pageTotal = rows.reduce((s, r) => s + r.tm + r.tk + r.grab + r.shopee + r.cp, 0); // DT thật gồm két
  assert.equal(pageTotal, 7_620_000 + 1_500_000 + 5_000_000);
  const pnl = computePnl({ storeIds: ["a", "b"], dates: ["2026-11-01", "2026-11-02"], revenue: rows, expenses: [], fixed: [], labor: [], fees: {} });
  assert.equal(pnl.total.revenue, pageTotal);
  assert.equal(pnl.total.cashbox, 120_000);
});
