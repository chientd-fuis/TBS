import { test } from "node:test";
import assert from "node:assert/strict";
import { weatherAdvice, weatherIcon, weatherKind } from "../src/lib/weather";
import { buildWeatherAlerts, forecastStaff, learnWeatherImpact } from "../src/lib/forecast";

const day = (tMax: number, rainPct: number) => ({ date: "2026-11-12", tMin: tMax - 5, tMax, rainPct, rainMm: 0, code: 3 });

test("Thời tiết: mưa > 60% cảnh báo, lạnh < 22°C giảm ca", () => {
  assert.deepEqual([weatherAdvice(day(30, 40)).reduce, weatherAdvice(day(30, 40)).factor], [false, 1]);
  assert.equal(weatherAdvice(day(30, 60)).rain, false); // đúng 60% chưa cảnh báo
  assert.equal(weatherAdvice(day(30, 61)).factor, 0.8);
  assert.equal(weatherAdvice(day(21, 10)).cold, true);
  assert.equal(weatherAdvice(day(21, 80)).factor, 0.65);
  assert.match(weatherAdvice(day(21, 80)).text, /mưa 80%.*lạnh.*nên giảm ca/);
  // lạnh theo nhiệt độ TRUNG BÌNH ngày: 17–23° → TB 20° → lạnh; 20–25° → TB 22,5° → không lạnh (dù thấp nhất 20°)
  assert.equal(weatherAdvice({ date: "2026-12-01", tMin: 17, tMax: 23, rainPct: 0, rainMm: 0, code: 2 }).cold, true);
  assert.match(weatherAdvice({ date: "2026-12-01", tMin: 17, tMax: 23, rainPct: 0, rainMm: 0, code: 2 }).text, /TB 20°/);
  assert.equal(weatherAdvice({ date: "2026-12-01", tMin: 20, tMax: 25, rainPct: 0, rainMm: 0, code: 2 }).cold, false);
  assert.equal(weatherIcon(63), "🌧️");
  assert.equal(weatherIcon(0), "☀️");
});

test("Thời tiết: dự báo số người giảm ngày mưa", () => {
  const templates = [{ id: "S", name: "S", startTime: "08:00", targetStaff: 2, minStaff: 1 }];
  const history = Array.from({ length: 6 }, (_, i) => ({ date: `2026-10-${String(1 + i * 7).padStart(2, "0")}`, tplId: "S", rev: 3_000_000, staff: 3 }));
  const base = { history, templates, days: ["2026-11-12"], holidays: new Set<string>(), pastHolidays: new Set<string>() };
  assert.equal(forecastStaff(base).cells[0].suggest, 3);
  assert.equal(forecastStaff({ ...base, weatherFactor: new Map([["2026-11-12", 0.65]]) }).cells[0].suggest, 2);
});

test("Thời tiết: học ảnh hưởng mưa / lạnh từ doanh thu quán", () => {
  // 8 thứ Tư: 5 ngày thường 4tr, 3 ngày mưa 2tr → mưa −50%; lạnh chưa đủ mẫu → mặc định
  const dates = ["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"];
  const rainy = new Set(["2026-08-19", "2026-09-02", "2026-09-16"]);
  const history = dates.map((d) => ({ date: d, tplId: "S", rev: rainy.has(d) ? 2_000_000 : 4_000_000, staff: 2 }));
  const kind = new Map(dates.map((d) => [d, rainy.has(d) ? ("rain" as const) : ("normal" as const)]));
  const im = learnWeatherImpact(history, kind, new Set());
  assert.deepEqual(im.rain, { factor: 0.5, samples: 3, learned: true });
  assert.equal(im.cold.learned, false);
  assert.equal(im.cold.factor, 0.8);
  assert.equal(im.both.factor, 0.4); // mưa 0,5 × lạnh 0,8
  // < 3 ngày mưa → chưa học, dùng mặc định
  const few = learnWeatherImpact(history, new Map([...kind].map(([d, k]) => [d, d === "2026-09-16" ? "normal" : k])), new Set());
  assert.equal(few.rain.learned, false);
});

test("Thời tiết: ngày đã qua mưa theo lượng mưa thực", () => {
  const w = { date: "2026-10-01", tMin: 24, tMax: 30, rainPct: 30, rainMm: 12, code: 63 };
  assert.equal(weatherKind(w, true), "rain");
  assert.equal(weatherKind(w), "normal");
});

test("Thời tiết: cảnh báo Tổng quan chỉ gợi ý giảm ca có dữ liệu doanh thu", () => {
  const templates = [
    { id: "S", name: "Sáng", startTime: "08:00", targetStaff: 2, minStaff: 1 },
    { id: "T", name: "Tối", startTime: "18:00", targetStaff: 2, minStaff: 1 },
  ];
  const d = "2026-11-12";
  const weather = new Map([[d, { date: d, tMin: 22, tMax: 28, rainPct: 85, rainMm: 10, code: 63 }], ["2026-11-13", { date: "2026-11-13", tMin: 25, tMax: 31, rainPct: 10, rainMm: 0, code: 1 }]]);
  const cells = [
    { date: d, tplId: "S", rev: 1_600_000, suggest: 2, current: 2, samples: 4 }, // có dữ liệu: gợi ý 2, đang xếp 3 → giảm 1
    { date: d, tplId: "T", rev: 0, suggest: 2, current: 2, samples: 0 }, // chưa có dữ liệu: KHÔNG gợi ý giảm dù đang xếp 4
    { date: "2026-11-13", tplId: "S", rev: 3_000_000, suggest: 2, current: 2, samples: 4 },
  ];
  const out = buildWeatherAlerts({
    days: [d, "2026-11-13"],
    weather,
    factors: { rain: 0.8, cold: 0.8, both: 0.65 },
    templates,
    cells,
    perStaff: { S: 800_000 },
    assigned: { [`${d}|S`]: 3, [`${d}|T`]: 4, "2026-11-13|S": 5 },
  });
  assert.equal(out.length, 1); // 13/11 trời đẹp → không cảnh báo (dù đang xếp 5)
  assert.deepEqual(out[0].cuts.map((c) => [c.tplName, c.suggest, c.planned]), [["Sáng", 2, 3]]);
  assert.deepEqual(out[0].noData, ["Tối"]);
  assert.equal(out[0].dropPct, 20);
});
