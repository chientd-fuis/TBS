import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOcr } from "../src/lib/revenue";

// Tờ chốt ca ghi tay: TM 2020 · TK Bơ sầu 1165 · TK Hải Yến 7045 · TK An Khánh 3685 · chi 40k đá · tổng 13955 · NV ghi chú
test("nhiều dòng TK → TK = tổng, chi tiết + ghi chú NV vào note", () => {
  const r = normalizeOcr(
    {
      tm: 2020,
      tk: 11895,
      tk_items: [
        { name: "Bơ sầu", amount: 1165 },
        { name: "Hải Yến", amount: 7045 },
        { name: "An Khánh", amount: 3685 },
      ],
      cp: 40,
      cp_detail: "40 đá",
      staff_total: 13955,
      staff_note: "Khách cho 5k tiền mặt vì không có tiền lẻ ạ. CK lại khách 5k – khách tự lấy ạ",
    },
    "2026-11-17",
  );
  assert.equal(r.scaled, true);
  assert.equal(r.values.tm, 2_020_000);
  assert.equal(r.values.tk, 11_895_000);
  assert.equal(r.values.cp, 40_000);
  assert.equal(r.staffTotal, 13_955_000);
  assert.match(r.note ?? "", /^TK: Bơ sầu 1\.165\.000 \+ Hải Yến 7\.045\.000 \+ An Khánh 3\.685\.000/);
  assert.match(r.note ?? "", /NV ghi chú: Khách cho 5k/);
});

test("AI cộng sai TK → lấy tổng các dòng", () => {
  const r = normalizeOcr({ tm: 1000, tk: 9999, tk_items: [{ name: "A", amount: 1000 }, { name: "B", amount: 2000 }] });
  assert.equal(r.values.tk, 3_000_000);
});

test("1 dòng TK → không thêm chi tiết TK vào ghi chú", () => {
  const r = normalizeOcr({ tm: 1000, tk: 2000, tk_items: [{ name: "Bơ sầu", amount: 2000 }], note: "cơm ca chiều" });
  assert.equal(r.note, "cơm ca chiều");
});
