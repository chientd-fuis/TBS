import { test } from "node:test";
import assert from "node:assert/strict";
import { evalCalc } from "../src/lib/calc-expr";

test("tính biểu thức tiền: nhân / chia / k / tr / % / ngoặc", () => {
  assert.equal(evalCalc("31 × 5000"), 155_000);
  assert.equal(evalCalc("31*5k"), 155_000);
  assert.equal(evalCalc("31 x 5.000"), 155_000);
  assert.equal(evalCalc("3*35k + 2*55k"), 215_000);
  assert.equal(evalCalc("3*35k + 2*55k - 10%"), 193_500);
  assert.equal(evalCalc("1tr2 / 4"), 300_000);
  assert.equal(evalCalc("1tr"), 1_000_000);
  assert.equal(evalCalc("1,5tr"), 1_500_000);
  assert.equal(evalCalc("(20k + 15k) * 2"), 70_000);
  assert.equal(evalCalc("1.200.000 : 3"), 400_000);
  assert.equal(evalCalc("5 nghìn × 31"), 155_000);
  assert.equal(evalCalc("155.000đ"), 155_000);
});

test("biểu thức sai → null (không đoán)", () => {
  assert.equal(evalCalc(""), null);
  assert.equal(evalCalc("31 × "), null);
  assert.equal(evalCalc("5 / 0"), null);
  assert.equal(evalCalc("abc"), null);
  assert.equal(evalCalc("process.exit()"), null);
  assert.equal(evalCalc("(1+2"), null);
});
