import type { ReactNode } from "react";
import { Types } from "mongoose";
import { Attendance, RevenueGap, UnpaidOrder } from "@/lib/models";
import { payStoreFilter } from "@/lib/attendance";
import { hoursVi, vnd } from "@/lib/format";
import { viMonth } from "@/lib/time";

type Item = {
  userId: unknown;
  name: string;
  workDays: number;
  totalHours: number;
  lateCount: number;
  earlyCount: number;
  totalBonus: number;
  totalPenalty: number;
};
type Bp = { userId?: unknown; kind?: string | null; content?: string | null; amountVnd?: number | null };
type Row = { key: string; name: string; main: ReactNode; sub?: ReactNode };

const TOP = 5;
const MEDAL = ["🥇", "🥈", "🥉"];

function Section({ icon, title, hint, rows, empty, tone = "good" }: { icon: string; title: string; hint: string; rows: Row[]; empty: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-danger" : "text-warn";
  return (
    <section className="rounded-xl bg-cream p-3 ring-1 ring-line">
      <p className="font-bold text-accent">
        {icon} {title}
      </p>
      <p className="mb-1.5 text-[11px] text-ink/55">{hint}</p>
      {rows.length ? (
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.key} className="flex items-start gap-2 text-sm">
              <span className="w-6 shrink-0 text-center">{MEDAL[i] ?? `${i + 1}.`}</span>
              <span className="min-w-0 flex-1">
                <b>{r.name}</b>
                {r.sub && <span className="block text-xs text-ink/60">{r.sub}</span>}
              </span>
              <span className={`shrink-0 text-right font-semibold tabular-nums ${color}`}>{r.main}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-2 text-center text-xs text-ink/50">{empty}</p>
      )}
    </section>
  );
}

/**
 * Cuối trang Bảng lương: tổng hợp nhân viên của tháng (panel đóng sẵn, bấm mới mở):
 * chăm chỉ nhất, đúng giờ / đi muộn, quên check-out, bị phạt nhiều nhất, được thưởng, thu ngân gây thất thoát.
 */
export default async function PayrollInsights({ storeId, month, items, bps }: { storeId: Types.ObjectId; month: string; items: Item[]; bps: Bp[] }) {
  const id = String(storeId);
  const nameOf = new Map(items.map((i) => [String(i.userId), i.name]));
  const [lateAgg, missing, gaps, unpaid] = await Promise.all([
    // tổng phút đi muộn từng người (lượt tính lương cho cơ sở này)
    Attendance.aggregate<{ _id: unknown; m: number }>([
      { $match: { month, lateMinutes: { $gt: 0 }, ...payStoreFilter(storeId) } },
      { $group: { _id: "$userId", m: { $sum: "$lateMinutes" } } },
    ]),
    Attendance.aggregate<{ _id: unknown; n: number }>([
      { $match: { month, status: "MISSING_CHECKOUT", ...payStoreFilter(storeId) } },
      { $group: { _id: "$userId", n: { $sum: 1 } } },
    ]),
    RevenueGap.find({ storeId, month }).select("date parts status").lean(),
    UnpaidOrder.find({ storeId, date: { $regex: `^${month}` }, status: { $nin: ["PAID", "DISMISSED"] } })
      .select("userId name amount status")
      .lean(),
  ]);
  const lateMin = new Map(lateAgg.map((x) => [String(x._id), x.m]));

  // ---- chăm chỉ: nhiều ngày công nhất, rồi nhiều giờ nhất
  const worked = items.filter((i) => i.workDays > 0);
  const diligent = [...worked]
    .sort((a, b) => b.workDays - a.workDays || b.totalHours - a.totalHours)
    .slice(0, TOP)
    .map((i) => ({ key: String(i.userId), name: i.name, main: `${i.workDays} ngày`, sub: `${hoursVi(i.totalHours)} · đi muộn ${i.lateCount} lần` }));

  // ---- đúng giờ: không đi muộn / về sớm, làm từ 5 ngày
  const punctual = worked
    .filter((i) => i.lateCount === 0 && i.earlyCount === 0 && i.workDays >= 5)
    .sort((a, b) => b.workDays - a.workDays)
    .slice(0, TOP)
    .map((i) => ({ key: String(i.userId), name: i.name, main: "0 lần muộn", sub: `${i.workDays} ngày công` }));

  // ---- đi muộn nhiều
  const late = worked
    .filter((i) => i.lateCount > 0)
    .sort((a, b) => b.lateCount - a.lateCount || (lateMin.get(String(b.userId)) ?? 0) - (lateMin.get(String(a.userId)) ?? 0))
    .slice(0, TOP)
    .map((i) => ({
      key: String(i.userId),
      name: i.name,
      main: `${i.lateCount} lần`,
      sub: `tổng ${lateMin.get(String(i.userId)) ?? 0} phút${i.earlyCount ? ` · về sớm ${i.earlyCount} lần` : ""}`,
    }));

  // ---- quên check-out
  const forgot = missing
    .sort((a, b) => b.n - a.n)
    .slice(0, TOP)
    .map((x) => ({ key: String(x._id), name: nameOf.get(String(x._id)) ?? "?", main: `${x.n} lần` }));

  // ---- phạt nhiều nhất (+ lý do hay gặp)
  const penaltyBy = new Map<string, { n: number; reasons: Map<string, number> }>();
  for (const b of bps.filter((b) => b.kind === "PENALTY")) {
    const k = String(b.userId);
    const x = penaltyBy.get(k) ?? { n: 0, reasons: new Map() };
    x.n++;
    // gom lý do theo vài chữ đầu ("Đi muộn 12 phút" → "Đi muộn")
    const r = (b.content ?? "Khác").replace(/\d.*$/, "").replace(/[–(:-]\s*$/, "").trim().slice(0, 30) || "Khác";
    x.reasons.set(r, (x.reasons.get(r) ?? 0) + 1);
    penaltyBy.set(k, x);
  }
  const penalized = items
    .filter((i) => i.totalPenalty > 0)
    .sort((a, b) => b.totalPenalty - a.totalPenalty)
    .slice(0, TOP)
    .map((i) => {
      const x = penaltyBy.get(String(i.userId));
      const top = x ? [...x.reasons.entries()].sort((a, b) => b[1] - a[1])[0] : null;
      return { key: String(i.userId), name: i.name, main: vnd(i.totalPenalty), sub: x ? `${x.n} lần${top ? ` · hay gặp: ${top[0]} (${top[1]})` : ""}` : undefined };
    });

  // ---- thưởng nhiều nhất
  const rewarded = items
    .filter((i) => i.totalBonus > 0)
    .sort((a, b) => b.totalBonus - a.totalBonus)
    .slice(0, TOP)
    .map((i) => ({ key: String(i.userId), name: i.name, main: vnd(i.totalBonus) }));

  // ---- thu ngân gây thất thoát: thiếu tiền theo ca chốt (Bù doanh thu – phần chia cho từng ca) + đơn chưa thanh toán chưa đòi được
  const loss = new Map<string, { name: string; short: number; days: Set<string>; unpaid: number; unpaidN: number }>();
  const get = (uid: string, name: string) => {
    const x = loss.get(uid) ?? { name: nameOf.get(uid) ?? name ?? "?", short: 0, days: new Set<string>(), unpaid: 0, unpaidN: 0 };
    loss.set(uid, x);
    return x;
  };
  for (const g of gaps)
    for (const p of g.parts ?? []) {
      if (!p.userId || !(p.amount && p.amount < 0)) continue;
      const x = get(String(p.userId), p.name ?? "?");
      x.short += -p.amount;
      x.days.add(g.date);
    }
  for (const u of unpaid) {
    if (!u.userId) continue;
    const x = get(String(u.userId), u.name ?? "?");
    x.unpaid += u.amount ?? 0;
    x.unpaidN++;
  }
  const leaky = [...loss.entries()]
    .map(([k, x]) => ({ k, x, sum: x.short + x.unpaid }))
    .filter((r) => r.sum > 0 || r.x.unpaidN > 0)
    .sort((a, b) => b.sum - a.sum)
    .slice(0, TOP)
    .map(({ k, x, sum }) => ({
      key: k,
      name: x.name,
      main: vnd(sum),
      sub: [x.short ? `thiếu tiền ${vnd(x.short)} (${x.days.size} ngày)` : "", x.unpaidN ? `đơn chưa TT ${x.unpaidN} đơn ${x.unpaid ? vnd(x.unpaid) : ""}` : ""].filter(Boolean).join(" · "),
    }));

  return (
    <details className="group rounded-2xl bg-card ring-1 ring-line">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-4 select-none [&::-webkit-details-marker]:hidden">
        <span className="text-lg">📊</span>
        <span className="min-w-0 flex-1">
          <b className="text-accent">Tổng hợp nhân viên tháng {viMonth(month)}</b>
          <span className="block text-xs text-ink/60">Chăm chỉ nhất · đúng giờ / đi muộn · quên check-out · bị phạt nhiều · được thưởng · thu ngân gây thất thoát</span>
        </span>
        <span className="shrink-0 rounded-lg bg-mute-bg px-2.5 py-1 text-xs font-semibold text-ink/70 group-open:hidden">Bấm để xem ▾</span>
        <span className="hidden shrink-0 rounded-lg bg-mute-bg px-2.5 py-1 text-xs font-semibold text-ink/70 group-open:inline">Thu gọn ▴</span>
      </summary>
      <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2 xl:grid-cols-3">
        <Section icon="🏆" title="Đi làm chăm chỉ nhất" hint="Nhiều ngày công nhất, bằng nhau thì nhiều giờ hơn" rows={diligent} empty="Chưa có ai đi làm" />
        <Section icon="⏱" title="Đúng giờ nhất" hint="Không đi muộn, không về sớm – làm từ 5 ngày" rows={punctual} empty="Chưa có ai đủ điều kiện" />
        <Section icon="🐢" title="Đi muộn nhiều nhất" hint="Số lần đi muộn · tổng số phút muộn" rows={late} empty="Không ai đi muộn 🎉" tone="warn" />
        <Section icon="🚪" title="Quên check-out nhiều nhất" hint="Lượt bị đánh dấu quên check-out" rows={forgot} empty="Không ai quên check-out" tone="warn" />
        <Section icon="🔻" title="Dính phạt nhiều nhất" hint="Tổng tiền phạt tháng · số lần · lý do hay gặp" rows={penalized} empty="Không ai bị phạt" tone="bad" />
        <Section icon="🎁" title="Được thưởng nhiều nhất" hint="Tổng tiền thưởng tháng" rows={rewarded} empty="Chưa có thưởng" />
        <div className="md:col-span-2 xl:col-span-3">
          <Section
            icon="💸"
            title="Thu ngân gây thất thoát nhiều nhất"
            hint="Thiếu tiền theo ca chốt (phần chia cho từng ca ở Bù doanh thu, kể cả đã duyệt / không phạt) + đơn chưa thanh toán chưa đòi được"
            rows={leaky}
            empty="Không có thất thoát ghi nhận"
            tone="bad"
          />
        </div>
      </div>
    </details>
  );
}
