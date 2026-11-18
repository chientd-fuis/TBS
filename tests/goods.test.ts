import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanLines, DEFAULT_GOODS, parseGoodsText, qtyAlert } from "../src/lib/goods";

const read = (t: string) => parseGoodsText(t).lines.map((l) => `${l.name} ${l.qty}${l.unit ? ` ${l.unit}` : ""}`);

test("kem: số < 100 = hộp, ≥ 100 = gam, 1+245 = 1 hộp + 245 g", () => {
  assert.deepEqual(read("Kem dâu 1+194"), ["Kem dâu 1 hộp", "Kem dâu 194 g"]);
  assert.deepEqual(read("Kem khoai môn 1+ 695"), ["Kem km 1 hộp", "Kem km 695 g"]);
  assert.deepEqual(read("Kem xoài 1545"), ["Kem xoài 1545 g"]);
  assert.deepEqual(read("Kem dừa 2h"), ["Kem dừa 2 hộp"]);
  assert.deepEqual(read("Kem scl 1"), ["Kem scl 1 hộp"]);
  assert.deepEqual(read("Kem dừa 70"), ["Kem dừa 70 hộp"]);
  assert.deepEqual(read("Kem matcha 1h + 300g"), ["Kem matcha 1 hộp", "Kem matcha 300 g"]);
});

test("món khác: 1+1 cộng lại, + giữa 2 món vẫn tách", () => {
  assert.deepEqual(read("Sầu múi 1+1"), ["Sầu múi 2"]);
  assert.deepEqual(read("Bơ 2 + Mít 3"), ["Bơ 2", "Mít 3"]);
  assert.deepEqual(read("Mít 4.5"), ["Mít 4.5"]);
  assert.deepEqual(read("Sương sa 0,2"), ["Sương sa 0.2"]);
  assert.deepEqual(read("nhận 5mn, 2nl"), ["Mini 5 hộp", "Ngàn lớp 2 bánh"]);
});

test("tin tồn kho dán nguyên đoạn (1 dòng) – không mất món", () => {
  const t =
    "Sầu sên 8 Sầu múi 35 Hạt đác 4 Thốt nốt 6 Dừa non 5 Lọt 3 Bơ 2 Kem dừa 2h Kem dâu 1+194 Kem xoài 1545 Kem khoai môn 1+ 695 Kem matcha 1+595 Kem scl 1 Kem cv 2814 Xúc xích 19 Nước dừa Mít 4.5 Xoài 8 Dưa hấu 1 Thanh long 2 Sương sa 0,2 Trứng 220";
  const r = parseGoodsText(t);
  const got = read(t);
  for (const x of ["Sầu sên 8", "Sầu múi 35", "Kem dừa 2 hộp", "Kem dâu 1 hộp", "Kem dâu 194 g", "Kem xoài 1545 g", "Kem km 1 hộp", "Kem km 695 g", "Kem matcha 595 g", "Kem scl 1 hộp", "Kem cv 2814 g", "Xúc xích 19", "Mít 4.5", "Sương sa 0.2"])
    assert.ok(got.includes(x), `thiếu "${x}" trong ${JSON.stringify(got)}`);
  assert.equal(r.lines.length, got.length);
  assert.deepEqual(r.unknown, ["Nước dừa – thiếu số lượng", "Trứng 220"]);
});

test("cleanLines: kem AI trả về không đơn vị → tự gán hộp / g", () => {
  const l = cleanLines([{ name: "Kem dâu", qty: 1, unit: "" }, { name: "Kem dâu", qty: 194, unit: "" }, { name: "Mít", qty: 2, unit: "" }], DEFAULT_GOODS, true);
  assert.deepEqual(l, [
    { name: "Kem dâu", qty: 1, unit: "hộp" },
    { name: "Kem dâu", qty: 194, unit: "g" },
    { name: "Mít", qty: 2, unit: "" },
  ]);
});

test("quy luật TÊN SỐ: món thiếu số → báo thiếu, số của chữ lạ không gán sang món sau", () => {
  const r = parseGoodsText("XX 19 kem sl 1+245 sầu 8 nước dừa mít 4,5");
  assert.deepEqual(read("XX 19 kem sl 1+245 sầu 8 nước dừa mít 4,5"), ["Xúc xích 19", "Kem scl 1 hộp", "Kem scl 245 g", "Mít 4.5"]);
  assert.deepEqual(r.unknown, ["sầu 8", "Nước dừa – thiếu số lượng"]);
  // xuống dòng cũng vậy
  const r2 = parseGoodsText("Xúc xích 19\nNước dừa\nMít 4.5");
  assert.deepEqual(r2.unknown, ["Nước dừa – thiếu số lượng"]);
  // nhận hàng không ghi số → vẫn 1
  assert.deepEqual(read("nhận mini, bơ"), ["Mini 1 hộp", "Bơ 1"]);
  assert.deepEqual(read("nhận 5mn, 2nl, nước dừa"), ["Mini 5 hộp", "Ngàn lớp 2 bánh", "Nước dừa 1"]);
});

test("cảnh báo số lượng lớn: > 50 xem lại, > 200 bất thường (món đếm cái / quả)", () => {
  assert.equal(qtyAlert({ name: "Xúc xích", qty: 19, unit: "" }), null);
  assert.equal(qtyAlert({ name: "Xúc xích", qty: 60, unit: "" }), "high");
  assert.equal(qtyAlert({ name: "Sữa đặc", qty: 220, unit: "" }), "abnormal");
  assert.equal(qtyAlert({ name: "Mít", qty: 300, unit: "g" }), null); // ghi theo gam → không cảnh báo
  assert.equal(qtyAlert({ name: "Kem xoài", qty: 1545, unit: "g" }), null);
  assert.equal(qtyAlert({ name: "Sầu múi", qty: 300, unit: "" }), null);
});

test("bơ: không cảnh báo số lớn; số thập phân = kg", () => {
  assert.equal(qtyAlert({ name: "Bơ", qty: 300, unit: "" }), null);
  assert.deepEqual(read("Bơ 2,5"), ["Bơ 2.5 kg"]);
  assert.deepEqual(read("Bơ 3"), ["Bơ 3"]);
  assert.deepEqual(read("Bơ 3 túi"), ["Bơ 3 túi"]);
  assert.deepEqual(cleanLines([{ name: "Bơ", qty: 1.5, unit: "" }], DEFAULT_GOODS), [{ name: "Bơ", qty: 1.5, unit: "kg" }]);
});
