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

test("lãi lỗ: doanh thu − phí sàn − tiền két − bill − chung − lương − cố định", () => {
  const r = computePnl({
    storeIds: ["a", "b"],
    dates: ["2026-11-01", "2026-11-02"],
    revenue: [
      { storeId: "a", date: "2026-11-01", dt: 3_000_000, cp: 50_000, grab: 1_000_000, shopee: 0 },
      { storeId: "b", date: "2026-11-01", dt: 1_000_000, cp: 0, grab: 0, shopee: 0 },
    ],
    expenses: [
      { date: "2026-11-01", amount: 400_000, scope: "STORE", storeId: "a", category: "NGUYEN_LIEU" },
      { date: "2026-11-01", amount: 200_000, scope: "SHARED", allocation: "REVENUE", category: "BAO_BI" },
      { date: "2026-11-01", amount: 30_000, scope: "STORE", storeId: "a", paidFrom: "CASHBOX" }, // không cộng lại
    ],
    fixed: [{ amountPerMonth: 3_000_000, scope: "STORE", storeId: "b", startMonth: "2026-01", category: "MAT_BANG" }],
    labor: [{ storeId: "a", date: "2026-11-01", amount: 500_000 }],
    fees: { a: { grab: 25, shopee: 0 } },
  });
  const a1 = r.cells["2026-11-01|a"];
  assert.equal(a1.platformFee, 250_000);
  assert.equal(a1.shared, 150_000); // 200k × 3/4
  assert.equal(a1.profit, 3_000_000 - 250_000 - 50_000 - 400_000 - 150_000 - 500_000);
  assert.equal(r.cells["2026-11-01|b"].shared, 50_000);
  assert.equal(r.cells["2026-11-02|b"].fixed, 100_000); // 3tr / 30 ngày
  assert.equal(r.byStore.b.fixed, 200_000);
  assert.equal(r.total.revenue, 4_000_000);
  assert.equal(r.total.profit, r.byStore.a.profit + r.byStore.b.profit);
  assert.equal(r.byCategory.NGUYEN_LIEU, 400_000);
  assert.equal(r.byCategory.MAT_BANG, 200_000);
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
  assert.match(c, /Cơ sở: Chung – theo tỷ lệ doanh thu/);
  assert.match(c, /Nguồn tiền: Chủ trả/);
  assert.match(formatExpenseCaption({ date: "2026-11-05", weekday: "Thứ 5", amount: 1, category: "KHAC", storeName: "TBS Văn Phú", by: "x", deleted: true }), /^🗑 ĐÃ XOÁ CHI PHÍ[\s\S]*Cơ sở: Văn Phú/);
});

test("nhận diện chuyển lương nhân viên, lương không cộng vào chi phí", async () => {
  const { detectSalary } = await import("../src/lib/finance");
  const staff = ["Nguyễn Thị Lan", "Trần Văn Nam"];
  assert.match(detectSalary({ vendor: "NGUYEN THI LAN", transferNote: "chuyen tien" }, staff)!, /Nguyễn Thị Lan/);
  assert.match(detectSalary({ vendor: "Le Hoa", transferNote: "TBS ung luong T11" }, staff)!, /ung luong/);
  assert.equal(detectSalary({ vendor: "CONG TY SUA VINAMILK", transferNote: "thanh toan don 123" }, staff), null);
  assert.equal(detectSalary({ vendor: "Lan", transferNote: "" }, staff), null); // 1 chữ → không đủ để khớp
  const r = computePnl({
    storeIds: ["a"], dates: ["2026-11-01"], revenue: [], fixed: [], labor: [], fees: {},
    expenses: [{ date: "2026-11-01", amount: 5_000_000, scope: "STORE", storeId: "a", category: "LUONG" }],
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
      { date: "2026-11-07", amount: 1_250_000, category: "NGUYEN_LIEU", target: "Geleximco", purpose: "Nhập sữa", recipient: "CONG TY SUA ABC" },
      { date: "2026-11-06", amount: 3_500_000, category: "LUONG", target: "Chung", purpose: "Lương T10", recipient: "NGUYEN THI LAN" },
    ],
    "Chủ",
  );
  assert.match(cap, /^💸 CHI PHÍ – 2 khoản · tính vào chi phí 1\.250\.000 đ/);
  assert.match(cap, /2\. 06\/11 · 3\.500\.000 · .* \(lương, không cộng\)/);
  assert.match(cap, /1 khoản lương NV/);
});
