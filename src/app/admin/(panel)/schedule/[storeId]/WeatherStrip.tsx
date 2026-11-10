import { weekdayVi } from "@/lib/time";
import { COLD_MAX_C, RAIN_WARN_PCT, weatherAdvice, weatherIcon, type DayWeather } from "@/lib/weather";

/** Dự báo thời tiết 7 ngày của tuần xếp ca + cảnh báo ngày mưa (> 60%) / lạnh (< 22°C) nên giảm ca. */
export default function WeatherStrip({ days, weather, today }: { days: string[]; weather: Map<string, DayWeather>; today: string }) {
  const future = days.filter((d) => d >= today);
  if (!future.some((d) => weather.has(d))) return null;
  const bad = future.flatMap((d) => {
    const w = weather.get(d);
    const a = w && weatherAdvice(w);
    return a?.reduce ? [{ d, a }] : [];
  });
  const label = (d: string) => `${weekdayVi(d).replace("Thứ ", "T").replace("Chủ Nhật", "CN")} ${d.slice(8)}/${d.slice(5, 7)}`;
  return (
    <div className={`rounded-2xl border p-3 text-sm ${bad.length ? "border-[#f5c99b] bg-[#fff8ef]" : "border-[#f1e6c8] bg-white"}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1">
        <b>🌤️ Thời tiết tuần này</b>
        <span className="text-[11px] text-ink/50">Open-Meteo · mưa &gt; {RAIN_WARN_PCT}% hoặc lạnh &lt; {COLD_MAX_C}°C → nên giảm ca (quán kem chè)</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {days.map((d) => {
          const w = weather.get(d);
          const a = w && weatherAdvice(w);
          const past = d < today;
          return (
            <div key={d} className={`rounded-xl px-1.5 py-1.5 text-center ${past ? "opacity-40" : ""} ${a?.reduce ? "bg-[#fde4cf] ring-1 ring-[#f0a35e]" : "bg-cream"}`}>
              <div className="text-[11px] font-semibold">{label(d)}</div>
              {w ? (
                <>
                  <div className="text-xl leading-tight">{weatherIcon(w.code)}</div>
                  <div className={`text-xs ${a?.cold ? "font-bold text-[#1e40af]" : ""}`}>
                    {Math.round(w.tMin)}–{Math.round(w.tMax)}°
                  </div>
                  <div className={`text-[11px] ${a?.rain ? "font-bold text-danger" : "text-ink/60"}`}>☔ {w.rainPct}%</div>
                </>
              ) : (
                <div className="py-2 text-[11px] text-ink/40">chưa có dự báo</div>
              )}
            </div>
          );
        })}
      </div>
      {!!bad.length && (
        <ul className="mt-2 space-y-0.5 text-[13px] font-semibold text-[#b45309]">
          {bad.map(({ d, a }) => (
            <li key={d}>
              ⚠ {label(d)}: {a.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
