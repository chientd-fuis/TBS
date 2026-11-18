import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUnpaid } from "../src/lib/unpaid-order";

const amt = (t: string) => parseUnpaid(t).map((x) => x.amount);

test("đọc đơn chưa thanh toán trong ghi chú", () => {
  assert.deepEqual(amt("25k Chưa TT"), [25000]);
  assert.deepEqual(amt("chưa thanh toán 25k"), [25000]);
  assert.deepEqual(amt("chưa TT 255"), [255000]);
  assert.deepEqual(amt("chua tt 30.000"), [30000]);
  assert.deepEqual(amt("1 đơn 45k chưa TT"), [45000]);
  assert.deepEqual(amt("khách nợ 30k; 20k ship"), [30000]);
  assert.deepEqual(amt("25k chưa TT, 40k chưa thanh toán"), [25000, 40000]);
  assert.deepEqual(amt("Bàn 3 chưa TT"), [0]); // không rõ số tiền → admin nhập khi phạt
  assert.deepEqual(amt("ca sáng âm 10k"), []);
  assert.deepEqual(amt("đã thanh toán đủ"), []);
});
