import { test } from "node:test";
import assert from "node:assert/strict";
import { nameScore } from "../src/lib/ask-ai";
import { amountOf, applyPick, calcInText, extraKindInText, moneyInText, monthInText, timesInText } from "../src/lib/ask-actions";

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
});

test("Trợ lý AI: số tiền lấy từ câu hỏi khi AI bỏ trống", () => {
  assert.equal(moneyInText("tháng 10 Đức tạm ứng 300k"), 300000);
  assert.equal(moneyInText("tháng 10 Đức tạm ứng 300000"), 300000);
  assert.equal(moneyInText("thêm tạm ứng 400k cho Đức, tháng 10"), 400000);
  assert.equal(moneyInText("thêm phụ cấp cho đức 200k tháng 10/2026"), 200000);
  assert.equal(moneyInText("ứng 1tr2 ngày 15/10"), 1200000);
  assert.equal(moneyInText("ứng 300.000đ"), 300000);
  assert.equal(moneyInText("sửa lương Tạ Đình chiến lên 23k/h từ tháng 11"), 23000);
  assert.equal(moneyInText("lương giờ 25.000đ/giờ"), 25000);
  assert.equal(moneyInText("Đức ứng tháng 10"), null);
  assert.equal(moneyInText("Lan 200k, Hà 300k"), null); // 2 số khác nhau → không đoán
  assert.deepEqual(timesInText("chấm công hộ tạ đình chiến ca sáng nay: giờ vào 8h"), ["08:00"]);
  assert.deepEqual(timesInText("vào 8h30 ra 17:15"), ["08:30", "17:15"]);
  assert.deepEqual(timesInText("vào 8 giờ, lương 23k/h"), ["08:00"]);
  assert.deepEqual(timesInText("chấm công hộ ca sáng nay"), []);
  assert.equal(calcInText("Khánh ship 31 đơn, mỗi đơn hỗ trợ 5k, thêm vào phụ cấp"), "31 × 5k");
  assert.equal(amountOf({ calc: calcInText("ship 12 đơn mỗi đơn 7.000đ") }).amount, 84000);
  assert.equal(calcInText("tạm ứng 300k tháng 10"), null);
  const q = "Khánh ship 31 đơn, mỗi đơn hỗ trợ 5k, thêm vào phụ cấp tháng 10";
  assert.equal(monthInText(q, "2026-11-10"), "2026-10");
  assert.equal(extraKindInText(q), "allowance");
  assert.equal(extraKindInText("tháng 10 Đức tạm ứng 300k"), "advance");
  assert.equal(extraKindInText("Đức ứng 300k"), "advance");
  assert.equal(monthInText("thêm tạm ứng 400k cho Đức, tháng 12", "2027-01-05"), "2026-12");
  assert.equal(monthInText("tạm ứng T10/2025 cho Đức", "2026-11-10"), "2025-10");
  assert.equal(monthInText("lương 23k/h từ tháng 12", "2026-11-10", false), "2026-12");
  assert.equal(monthInText("Đức ứng 300k", "2026-11-10"), null);
  assert.equal(applyPick({ person: "Khánh nguyễn" }, "Khánh nguyễn", "a".repeat(24)).person, `#id:${"a".repeat(24)}`);
  assert.deepEqual(applyPick({ people: ["Lan", "Khánh"] }, "khánh", "b".repeat(24)).people, ["Lan", `#id:${"b".repeat(24)}`]);
});
