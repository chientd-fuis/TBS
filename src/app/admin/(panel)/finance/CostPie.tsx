/* Biểu đồ tròn (donut) cơ cấu chi phí – SVG thuần, không cần JS. Rê chuột vào lát → tooltip; chú thích bên cạnh ghi số tiền + %. */

export type Slice = { key: string; label: string; value: number; color: string };

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

function arc(cx: number, cy: number, r: number, r0: number, a0: number, a1: number) {
  // góc tính từ 12h theo chiều kim đồng hồ
  const p = (rad: number, a: number) => [cx + rad * Math.sin(a), cy - rad * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r, a0);
  const [x1, y1] = p(r, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

export default function CostPie({ slices, total, revenue }: { slices: Slice[]; total: number; revenue: number }) {
  const shown = slices.filter((s) => s.value > 0);
  if (!shown.length || total <= 0) return <p className="py-6 text-center text-sm text-ink/50">Chưa có chi phí.</p>;
  const cx = 100;
  const cy = 100;
  let a = 0;
  const paths = shown.map((s) => {
    const sweep = (s.value / total) * Math.PI * 2;
    const a0 = a;
    a += sweep;
    // 1 lát duy nhất = vòng tròn đủ → vẽ 2 nửa để path hợp lệ
    const d = sweep >= Math.PI * 2 - 1e-6 ? `${arc(cx, cy, 92, 58, 0, Math.PI)}${arc(cx, cy, 92, 58, Math.PI, Math.PI * 2)}` : arc(cx, cy, 92, 58, a0, a);
    return { ...s, d };
  });
  return (
    <div className="flex flex-col items-center gap-4">
      <svg viewBox="0 0 200 200" className="h-48 w-48 shrink-0" role="img" aria-label="Biểu đồ tròn cơ cấu chi phí">
        {paths.map((s) => (
          <path key={s.key} d={s.d} fill={s.color} stroke="#fff" strokeWidth={2} strokeLinejoin="round" className="transition-opacity hover:opacity-80">
            <title>{`${s.label}: ${vnd(s.value)} đ (${pct(s.value / total)})`}</title>
          </path>
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-ink/60 text-[10px]">Tổng chi phí</text>
        <text x={cx} y={cy + 10} textAnchor="middle" className="fill-ink text-[13px] font-bold">{vnd(total)}</text>
        {revenue > 0 && (
          <text x={cx} y={cy + 24} textAnchor="middle" className="fill-ink/50 text-[9px]">{pct(total / revenue)} doanh thu</text>
        )}
      </svg>
      <ul className="w-full min-w-0 space-y-1.5 text-xs">
        {shown.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span className="shrink-0 tabular-nums text-ink/70">{vnd(s.value)}</span>
            <span className="w-12 shrink-0 text-right font-semibold tabular-nums">{pct(s.value / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
