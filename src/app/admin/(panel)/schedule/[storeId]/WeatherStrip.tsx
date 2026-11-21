import { weatherAdvice, weatherIcon, type DayWeather } from "@/lib/weather";

/** Thời tiết 1 ngày – gọn, đặt trong ô tiêu đề cột ngày của lịch (mưa > 60% / lạnh TB < 22°C → nền cảnh báo). */
export function DayWeatherHead({ w, past }: { w?: DayWeather; past?: boolean }) {
  if (!w) return null;
  const a = weatherAdvice(w);
  return (
    <div
      className={`mt-1 rounded-md px-1 py-0.5 text-[11px] font-normal leading-tight ${past ? "opacity-50" : ""} ${a.reduce && !past ? "bg-late-bg text-ink ring-1 ring-warn-line" : ""}`}
      title={a.text || undefined}
    >
      <span className="text-sm">{weatherIcon(w.code)}</span>{" "}
      <span className={a.cold ? "font-bold text-info-fg" : ""}>
        {Math.round(w.tMin)}–{Math.round(w.tMax)}°
      </span>
      <div className={a.rain ? "font-bold text-danger" : "opacity-70"}>☔ {w.rainPct}%</div>
    </div>
  );
}
