import { test } from "node:test";
import assert from "node:assert/strict";
import { nameScore } from "../src/lib/ask-ai";
import { amountOf, applyPick } from "../src/lib/ask-actions";

test("Trợ lý AI: gợi ý tên gần giống (bỏ dấu, đảo thứ tự từ)", () => {
  assert.ok(nameScore("Khánh nguyễn", "Nam Khánh") > 0);
  assert.ok(nameScore("Khánh nguyễn", "Nguyễn Văn Khánh") > nameScore("Khánh nguyễn", "Nam Khánh"));
  assert.equal(nameScore("Khánh", "Mai Anh"), 0);
});

test("Trợ lý AI: số tiền theo phép tính do server tính; chọn người thay đúng tên", () => {
  assert.deepEqual(amountOf({ amount: 150000, calc: "31 × 5000" }), { amount: 155000, calcLine: "Cách tính: 31 × 5000 = 155.000 ₫" });
  assert.equal(amountOf({ amount: 50000 }).amount, 50000);
  assert.equal(amountOf({ amount: 50000, calc: "abc" }).amount, 50000); // phép tính hỏng → dùng số AI
  assert.equal(amountOf({ amount: -300000 }).amount, 300000); // tạm ứng AI ghi số âm
  assert.equal(amountOf({ calc: "-300k" }).amount, 300000);
  assert.equal(applyPick({ person: "Khánh nguyễn" }, "Khánh nguyễn", "a".repeat(24)).person, `#id:${"a".repeat(24)}`);
  assert.deepEqual(applyPick({ people: ["Lan", "Khánh"] }, "khánh", "b".repeat(24)).people, ["Lan", `#id:${"b".repeat(24)}`]);
});
