import { test } from "node:test";
import assert from "node:assert/strict";
import { detectAnomalies, type ClosingLite } from "../src/lib/anomaly";
import { DEFAULT_ANOMALY } from "../src/lib/ai";

const at = (d: string, hm: string) => new Date(`${d}T${hm}:00+07:00`);
const C = (p: Partial<ClosingLite> & { id: string; workDate: string; shiftName: string; revenue: ClosingLite["revenue"] }): ClosingLite => ({
  storeId: "S1",
  staff: "Lâm",
  createdAt: at(p.workDate, p.shiftName === "Sáng" ? "13:05" : p.shiftName === "Chiều" ? "18:05" : "23:05"),
  shiftEnd: p.shiftName === "Sáng" ? "13:00" : p.shiftName === "Chiều" ? "18:00" : "23:00",
  ...p,
});

test("bất thường: thiếu tiền tính theo RIÊNG từng ca (chốt ca luỹ kế), lặp lại → nghiêm trọng", () => {
  const closings: ClosingLite[] = [];
  for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) {
    // Sáng đủ tiền; Tối (luỹ kế cả ngày) thiếu 200k – thuộc ca Tối
    closings.push(C({ id: `s${d}`, workDate: d, shiftName: "Sáng", staff: "Nga", revenue: { dt: 1_000_000, tm: 500_000, tk: 500_000, cp: 0, grab: 0, shopee: 0 } }));
    closings.push(C({ id: `t${d}`, workDate: d, shiftName: "Tối", revenue: { dt: 3_000_000, tm: 1_300_000, tk: 1_500_000, cp: 0, grab: 0, shopee: 0 } }));
  }
  const { items, byStaff } = detectAnomalies(closings, [], DEFAULT_ANOMALY);
  const short = items.filter((i) => i.type === "SHORT");
  assert.equal(short.length, 3);
  assert.ok(short.every((i) => i.staff === "Lâm" && i.sev === 3 && i.amount === 200_000), JSON.stringify(short));
  assert.equal(byStaff[0].staff, "Lâm");
  assert.equal(byStaff[0].shortSum, 600_000);
});

test("bất thường: két gấp nhiều lần trung bình, cộng sai tổng, chốt ca trễ, thiếu DT máy", () => {
  const history: ClosingLite[] = Array.from({ length: 10 }, (_, i) =>
    C({ id: `h${i}`, workDate: `2026-10-${String(10 + i).padStart(2, "0")}`, shiftName: "Sáng", revenue: { dt: 1_000_000, tm: 900_000, tk: 0, cp: 100_000, grab: 0, shopee: 0 } }),
  );
  const closings = [
    C({ id: "k", workDate: "2026-11-05", shiftName: "Sáng", staff: "Mai", revenue: { dt: 1_000_000, tm: 500_000, tk: 0, cp: 500_000, grab: 0, shopee: 0 } }),
    C({ id: "w", workDate: "2026-11-06", shiftName: "Sáng", staff: "Nga", staffTotal: 990_000, revenue: { dt: 1_000_000, tm: 1_000_000, tk: 0, cp: 0, grab: 0, shopee: 0 } }),
    C({ id: "l", workDate: "2026-11-07", shiftName: "Tối", staff: "Hùng", createdAt: at("2026-11-08", "01:40"), revenue: { dt: null as unknown as number, tm: 1_000_000, tk: 0, cp: 0, grab: 0, shopee: 0 } }),
  ];
  const { items } = detectAnomalies(closings, history, DEFAULT_ANOMALY);
  const by = (t: string) => items.find((i) => i.type === t);
  assert.equal(by("KET")?.staff, "Mai");
  assert.equal(by("KET")?.sev, 3); // 5 lần TB ≥ 2 × ngưỡng 2
  assert.equal(by("WRONG_TOTAL")?.staff, "Nga");
  assert.equal(by("LATE_CLOSE")?.staff, "Hùng");
  assert.match(by("LATE_CLOSE")?.detail ?? "", /2h40/);
  assert.equal(by("NO_DT")?.staff, "Hùng");
});
