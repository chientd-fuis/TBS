/** Nhãn tuần: chữ thường, in đậm – "Tuần này" xanh lá, "Tuần sau" cam, tuần khác xám. */
export function WeekBadge({ label }: { label?: string | null }) {
  if (!label) return null;
  const tone = label === "Tuần này" ? "text-good" : label === "Tuần sau" ? "text-warn" : "text-ink/60";
  return <span className={`text-sm font-bold ${tone}`}>{label}</span>;
}

/** Tên nhãn cho 1 tuần so với tuần hiện tại. */
export function weekLabel(ws: string, thisWeek: string, addDays: (d: string, n: number) => string) {
  if (ws === thisWeek) return "Tuần này";
  if (ws === addDays(thisWeek, 7)) return "Tuần sau";
  if (ws === addDays(thisWeek, -7)) return "Tuần trước";
  return null;
}
