import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogToText, cleanLines, DEFAULT_GOODS, goodsMessage, hasReceiveWord, lineVi, parseCatalog, parseGoodsText, sameLines } from "../src/lib/goods";

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
