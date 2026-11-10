import { test } from "node:test";
import assert from "node:assert/strict";
import { cashBalance, cashKindOf } from "../src/lib/cashbook";

test("sổ quỹ: TK = DT TK − bill CK − rút lãi + vốn ± chuyển; TM = DT TM − rút + vốn ± chuyển", () => {
  const f = cashBalance({
    revenue: [
      { tk: 3_000_000, tm: 1_000_000 },
      { tk: 2_000_000, tm: 500_000 },
    ],
    bills: [{ amount: 700_000 }, { amount: 300_000 }],
    moves: [
      { kind: "TAKE", account: "TK", amount: 1_000_000 },
      { kind: "TAKE", account: "TM", amount: 200_000 },
      { kind: "ADD", account: "TK", amount: 500_000 },
      { kind: "ADD", account: "TM", amount: 100_000 },
      { kind: "DEPOSIT", amount: 400_000 }, // TM → TK
      { kind: "WITHDRAW", amount: 50_000 }, // TK → TM
    ],
  });
  assert.equal(f.tk.balance, 5_000_000 - 1_000_000 - 1_000_000 + 500_000 + 400_000 - 50_000);
  assert.equal(f.tm.balance, 1_500_000 - 200_000 + 100_000 - 400_000 + 50_000);
  // chuyển qua lại không đổi tổng tiền
  assert.equal(f.tk.balance + f.tm.balance, 6_500_000 - 1_000_000 - 1_200_000 + 600_000);
});

test("sổ quỹ: phiếu cũ (chỉ DEPOSIT / WITHDRAW) vẫn đọc được; TAKE thiếu account coi là TK", () => {
  assert.equal(cashKindOf({ kind: "DEPOSIT" })?.short, "TM → TK");
  assert.equal(cashKindOf({ kind: "TAKE" })?.value, "TAKE_TK");
  assert.equal(cashKindOf({ kind: "ADD", account: "TM" })?.value, "ADD_TM");
  const f = cashBalance({ revenue: [], bills: [], moves: [{ kind: "TAKE", amount: 10 }] });
  assert.equal(f.tk.balance, -10);
  assert.equal(f.tm.balance, 0);
});
