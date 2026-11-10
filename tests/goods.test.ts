import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogToText, cleanLines, DEFAULT_GOODS, goodsMessage, hasReceiveWord, lineVi, parseCatalog, parseGoodsText, priceAt, sameLines, usageReport, type UsageRec } from "../src/lib/goods";

const read = (t: string) => parseGoodsText(t).lines.map(lineVi);

test("viết tắt của quán: 5mn, 2nl, bột na", () => {
  assert.deepEqual(read("nhận 5mn, 2nl, 3 bột na"), ["Mini: 5 hộp", "Ngàn lớp: 2 bánh", "Bột năng: 3"]);
  assert.deepEqual(read("Nhạn 5 mini 2 ngàn lớp"), ["Mini: 5 hộp", "Ngàn lớp: 2 bánh"]);
});

test("số đứng trước / sau tên, có đơn vị, x5, thập phân", () => {
  assert.deepEqual(read("nhan sầu múi 2kg + 3 thùng sữa tươi"), ["Sầu múi: 2 kg", "Sữa tươi: 3 thùng"]);
  assert.deepEqual(read("đã nhận: mini x5, kem scl 2 hộp, 2 bơ"), ["Mini: 5 hộp", "Kem scl: 2 hộp", "Bơ: 2"]);
  assert.deepEqual(read("nhận 1,5kg bột năng\n2 kem dau"), ["Bột năng: 1,5 kg", "Kem dâu: 2"]);
});

test("tên dài ưu tiên hơn (hộp nhựa mini ≠ bánh mini), món không số = 1", () => {
  assert.deepEqual(read("nhân 100 cốc 500, 2 túi rác, găng tay"), ["Cốc nhựa 500ml: 100", "Túi rác: 2", "Găng tay: 1"]);
  assert.deepEqual(read("nhận 2 hộp nhựa mini, 3 hop mini"), ["Hộp nhựa mini: 2", "Mini: 3 hộp"]);
});

test("đoạn không hiểu → unknown; chỉ có chữ nhận → bỏ qua", () => {
  const r = parseGoodsText("nhận abc xyz, 2 trân châu");
  assert.deepEqual(r.lines.map(lineVi), ["Trân trâu: 2"]);
  assert.deepEqual(r.unknown, ["nhận abc xyz"]);
  assert.deepEqual(parseGoodsText("nhận hàng sáng nay"), { lines: [], unknown: [] });
});

test("gộp món trùng", () => {
  assert.deepEqual(read("2mn, 3 mini"), ["Mini: 5 hộp"]);
});

test("danh mục: chữ ⇄ danh sách, bỏ trùng", () => {
  const t = catalogToText(DEFAULT_GOODS);
  assert.deepEqual(parseCatalog(t), DEFAULT_GOODS);
  const c = parseCatalog("Bột năng | gói | bột na\nbot nang\n\nTrà | | ");
  assert.deepEqual(c, [{ name: "Bột năng", unit: "gói", aliases: ["bột na"] }, { name: "Trà", unit: "", aliases: [] }]);
  assert.deepEqual(read("2 bột na"), ["Bột năng: 2"]);
});

test("cleanLines chỉ nhận món trong danh mục + số hợp lệ", () => {
  const l = cleanLines([{ name: "mini", qty: 5, unit: "hộp" }, { name: "Không có", qty: 1 }, { name: "Bơ", qty: -1 }, { name: "Bơ", qty: "2" }], DEFAULT_GOODS);
  assert.deepEqual(l, [{ name: "Mini", qty: 5, unit: "hộp" }, { name: "Bơ", qty: 2, unit: "" }]);
  assert.ok(sameLines(l, [{ name: "Bơ", qty: 2, unit: "" }, { name: "Mini", qty: 5, unit: "hộp" }]));
});

test("chữ nhận + tin Telegram", () => {
  assert.ok(hasReceiveWord("Nhạn 5mn") && hasReceiveWord("đã nhân 2 nl") && !hasReceiveWord("hết mini rồi"));
  const m = goodsMessage({ store: "TBS Cầu Giấy", date: "2026-11-10", by: "Lan", lines: [{ name: "Mini", qty: 5, unit: "hộp" }] });
  assert.equal(m, "📦 NHẬN HÀNG · TBS Cầu Giấy · 10/11/2026\n👤 Lan\n• Mini: 5 hộp");
});

test("giá theo ngày áp dụng: từ 15/11 tăng 20k, trước đó 19k", () => {
  const p = [{ from: "2026-11-15", price: 20000 }, { from: "2026-10-01", price: 19000 }];
  assert.equal(priceAt(p, "2026-11-14"), 19000);
  assert.equal(priceAt(p, "2026-11-15"), 20000);
  assert.equal(priceAt(p, "2026-09-01"), 19000); // trước mốc đầu → giá mốc đầu
  assert.equal(priceAt([], "2026-11-15"), null);
});

test("tiêu thụ tháng: theo nhập (chưa kiểm kho) và theo tồn kho", () => {
  const items = [{ name: "Mini", unit: "hộp", aliases: [], prices: [{ from: "2026-10-01", price: 19000 }, { from: "2026-11-15", price: 20000 }] }];
  const rec = (kind: "RECEIVE" | "STOCK", date: string, qty: number, unit = "hộp"): UsageRec => ({ kind, date, at: 0, lines: [{ name: "Mini", qty, unit }] });
  const recs = [rec("RECEIVE", "2026-11-10", 10), rec("RECEIVE", "2026-11-20", 10), rec("RECEIVE", "2026-11-21", 2, "thùng")];
  const [a] = usageReport({ from: "2026-11-01", to: "2026-11-30", items, recs, useStock: false });
  assert.deepEqual([a.mode, a.received, a.usage, a.value, a.skipped], ["receive", 20, 20, 10 * 19000 + 10 * 20000, 1]);
  // tồn 31/10 = 5, tồn 30/11 = 3 → tiêu thụ 5 + 20 − 3 = 22
  const withStock = [...recs, rec("STOCK", "2026-10-31", 5), rec("STOCK", "2026-11-30", 3)];
  const [b] = usageReport({ from: "2026-11-01", to: "2026-11-30", items, recs: withStock, useStock: true });
  assert.deepEqual([b.mode, b.open?.qty, b.received, b.close?.qty, b.usage], ["stock", 5, 20, 3, 22]);
  assert.equal(b.value, 5 * 19000 + 10 * 19000 + 10 * 20000 - 3 * 20000);
  // tắt tồn kho → bỏ qua số kiểm kho
  assert.equal(usageReport({ from: "2026-11-01", to: "2026-11-30", items, recs: withStock, useStock: false })[0].usage, 20);
  // chưa có giá → value null
  assert.equal(usageReport({ from: "2026-11-01", to: "2026-11-30", items: [{ ...items[0], prices: [] }], recs, useStock: false })[0].value, null);
});

test("báo tồn kho: tồn 3mn, hết sầu múi → 0", () => {
  assert.deepEqual(read("tồn 3mn, 1nl, hết sầu múi, kem dâu hết"), ["Mini: 3 hộp", "Ngàn lớp: 1 bánh", "Sầu múi: 0", "Kem dâu: 0"]);
  assert.deepEqual(cleanLines([{ name: "Mini", qty: 0 }], DEFAULT_GOODS), []);
  assert.deepEqual(cleanLines([{ name: "Mini", qty: 0 }], DEFAULT_GOODS, true), [{ name: "Mini", qty: 0, unit: "hộp" }]);
});

test("tiền hàng nhập trong tháng theo giá ngày nhận (kể cả khi tính tiêu thụ theo tồn kho)", () => {
  const items = [{ name: "Mini", unit: "hộp", aliases: [], prices: [{ from: "2026-10-01", price: 19000 }, { from: "2026-11-15", price: 20000 }] }];
  const rec = (kind: "RECEIVE" | "STOCK", date: string, qty: number): UsageRec => ({ kind, date, at: 0, lines: [{ name: "Mini", qty, unit: "hộp" }] });
  const recs = [rec("RECEIVE", "2026-10-31", 4), rec("RECEIVE", "2026-11-10", 10), rec("RECEIVE", "2026-11-20", 10), rec("STOCK", "2026-10-31", 5), rec("STOCK", "2026-11-30", 3)];
  const [r] = usageReport({ from: "2026-11-01", to: "2026-11-30", items, recs, useStock: true });
  assert.deepEqual([r.monthReceived, r.receivedValue, r.skipped], [20, 10 * 19000 + 10 * 20000, 0]);
});
