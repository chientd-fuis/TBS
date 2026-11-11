import { weekdayVi } from "@/lib/time";
import type { ActivityRow } from "./data";

const COLORS = ["bg-[#dbeafe] text-[#1e40af]", "bg-[#fde2e2] text-[#9a2a2a]", "bg-[#e3f4e6] text-[#256b37]", "bg-[#fff1cc] text-[#7a5600]", "bg-[#efe4fb] text-[#5b2d91]", "bg-[#ffe8d9] text-[#9a4a12]"];
const colorOf = (name: string) => COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length];
const GROUP_DOT: Record<string, string> = {
  attendance: "bg-[#2a78d6]",
  schedule: "bg-[#1baf7a]",
  bonus: "bg-[#e34948]",
  people: "bg-[#6250d6]",
  payroll: "bg-[#eda100]",
  revenue: "bg-[#eb6834]",
  finance: "bg-[#e87ba4]",
  system: "bg-[#9a9a92]",
  login: "bg-[#9a9a92]",
};

/** Danh sách hoạt động gom theo ngày (mới nhất trước). */
export default function ActivityFeed({ rows, today, empty = "Chưa có hoạt động nào" }: { rows: ActivityRow[]; today: string; empty?: string }) {
  if (!rows.length) return <p className="py-4 text-center text-sm text-ink/50">{empty}</p>;
  const days = [...new Set(rows.map((r) => r.day))];
  const dayTitle = (d: string) => {
    const dm = `${d.slice(8)}/${d.slice(5, 7)}`;
    const yest = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    return `${d === today ? "Hôm nay" : d === yest ? "Hôm qua" : weekdayVi(d)} · ${dm}`;
  };
  return (
    <div className="space-y-4">
      {days.map((d) => {
        const list = rows.filter((r) => r.day === d);
        return (
          <section key={d}>
            <h3 className="sticky top-[52px] z-10 mb-1 bg-white/95 lg:top-0 py-1 text-xs font-bold uppercase tracking-wide text-ink/50">
              {dayTitle(d)} <span className="font-normal normal-case">({list.length})</span>
            </h3>
            <ul className="divide-y divide-ink/5">
              {list.map((r) => (
                <li key={r.id} className="flex gap-3 py-2 text-sm">
                  <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-ink/50">{r.time}</span>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${GROUP_DOT[r.group] ?? "bg-ink/30"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colorOf(r.admin)}`}>{r.admin}</span>
                      <b className="font-semibold">{r.label}</b>
                    </div>
                    {r.summary && <p className="mt-0.5 break-words text-xs text-ink/70">{r.summary}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
