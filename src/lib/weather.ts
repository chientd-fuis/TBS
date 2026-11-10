/*
 * Dự báo thời tiết cho xếp ca (Open-Meteo – miễn phí, không cần key, dự báo tối đa 16 ngày).
 * Quán kem chè: mưa / lạnh → vắng khách → nên giảm ca.
 *  - khả năng mưa > 60%  → cảnh báo mưa
 *  - nhiệt độ TRUNG BÌNH ngày ((thấp + cao) / 2) < 22°C → lạnh (VD 17–23° → TB 20° → lạnh)
 *  - mưa hoặc lạnh → gợi ý giảm ca (dự báo doanh thu nhân hệ số WEATHER_FACTOR)
 */

/** Toạ độ mặc định khi cơ sở chưa có GPS: Hà Đông, Hà Nội */
export const DEFAULT_LATLNG = { lat: 20.9714, lng: 105.7788 };
export const RAIN_WARN_PCT = 60;
export const COLD_MAX_C = 22;
/** hệ số doanh thu dự báo: mưa ×0,8 · lạnh ×0,8 · cả hai ×0,65 */
export const WEATHER_FACTOR = { rain: 0.8, cold: 0.8, both: 0.65 } as const;

export type DayWeather = { date: string; tMax: number; tMin: number; rainPct: number; rainMm: number; code: number };
export type WeatherAdvice = { rain: boolean; cold: boolean; reduce: boolean; factor: number; text: string };

/** Nhiệt độ trung bình ngày = (thấp nhất + cao nhất) / 2 */
export const avgTemp = (d: Pick<DayWeather, "tMin" | "tMax">) => (d.tMin + d.tMax) / 2;

/** Loại ngày theo thời tiết. Ngày đã qua: mưa = lượng mưa thực ≥ 3mm (hoặc khả năng > 60%); ngày tới: khả năng mưa > 60%. */
export type WeatherKind = "normal" | "rain" | "cold" | "both";
export function weatherKind(d: DayWeather, past = false): WeatherKind {
  const rain = d.rainPct > RAIN_WARN_PCT || (past && d.rainMm >= 3);
  const cold = avgTemp(d) < COLD_MAX_C;
  return rain && cold ? "both" : rain ? "rain" : cold ? "cold" : "normal";
}
/** Hệ số doanh thu theo loại ngày – mặc định WEATHER_FACTOR, hoặc học từ dữ liệu quán (learnWeatherImpact). */
export type WeatherFactors = Record<Exclude<WeatherKind, "normal">, number>;

/** Hàm thuần: 1 ngày thời tiết → cảnh báo / gợi ý giảm ca (factors = hệ số đã học, không có → mặc định). */
export function weatherAdvice(d: DayWeather, factors: WeatherFactors = WEATHER_FACTOR): WeatherAdvice {
  const kind = weatherKind(d);
  const rain = kind === "rain" || kind === "both";
  const cold = kind === "cold" || kind === "both";
  const factor = kind === "normal" ? 1 : factors[kind];
  const why = [rain ? `mưa ${d.rainPct}%` : "", cold ? `lạnh ${Math.round(d.tMin)}–${Math.round(d.tMax)}°C (TB ${Math.round(avgTemp(d))}°)` : ""].filter(Boolean).join(", ");
  return { rain, cold, reduce: rain || cold, factor, text: why ? `${why} → nên giảm ca` : "" };
}

/** Mã thời tiết WMO → biểu tượng */
export function weatherIcon(code: number) {
  if (code >= 95) return "⛈️";
  if (code >= 61 || (code >= 51 && code <= 57) || code >= 80) return "🌧️";
  if (code >= 45 && code <= 48) return "🌫️";
  if (code >= 2) return "⛅";
  return "☀️";
}

/**
 * Thời tiết theo ngày tại toạ độ: 92 ngày đã qua (thực tế) + 16 ngày tới (dự báo), 1 lần gọi.
 * Lọc theo `days` nếu có. Ngày ngoài tầm / lỗi mạng → không có trong kết quả.
 * Cache 3 giờ (fetch của Next) – không gọi lại mỗi lần mở trang.
 */
export async function loadWeather(days: string[] | null, lat?: number | null, lng?: number | null): Promise<Map<string, DayWeather>> {
  const out = new Map<string, DayWeather>();
  if (days && !days.length) return out;
  const la = Number.isFinite(lat) && lat ? lat! : DEFAULT_LATLNG.lat;
  const lo = Number.isFinite(lng) && lng ? lng! : DEFAULT_LATLNG.lng;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${la.toFixed(3)}&longitude=${lo.toFixed(3)}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weather_code` +
    `&timezone=Asia%2FHo_Chi_Minh&past_days=92&forecast_days=16`;
  try {
    const res = await fetch(url, { next: { revalidate: 3 * 3600 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return out;
    const j = (await res.json()) as {
      daily?: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: (number | null)[]; precipitation_sum: number[]; weather_code: number[] };
    };
    const d = j.daily;
    if (!d) return out;
    d.time.forEach((date, i) => {
      if ((days && !days.includes(date)) || d.temperature_2m_max[i] == null) return;
      out.set(date, { date, tMax: d.temperature_2m_max[i], tMin: d.temperature_2m_min[i], rainPct: d.precipitation_probability_max[i] ?? 0, rainMm: d.precipitation_sum[i] ?? 0, code: d.weather_code[i] ?? 0 });
    });
  } catch (e) {
    console.warn("[weather]", (e as Error).message);
  }
  return out;
}

/** Nhãn thời tiết gọn cho đầu cột ngày (Lịch làm việc …); warn chỉ cho ngày từ hôm nay trở đi. */
export type WeatherBadge = { icon: string; tMin: number; tMax: number; rainPct: number; warn: string };
export function weatherBadges(weather: Map<string, DayWeather>, today: string, factors?: WeatherFactors): Record<string, WeatherBadge> {
  return Object.fromEntries(
    [...weather.values()].map((w) => [w.date, { icon: weatherIcon(w.code), tMin: Math.round(w.tMin), tMax: Math.round(w.tMax), rainPct: w.rainPct, warn: w.date >= today ? weatherAdvice(w, factors).text : "" }]),
  );
}
