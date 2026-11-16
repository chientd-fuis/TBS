import Link from "next/link";
import { isValidObjectId } from "mongoose";
import { requirePerm } from "@/lib/guards";
import { ShiftReminder, ShiftReminderSeen, Store } from "@/lib/models";
import { reminderTargets } from "@/lib/reminders";
import { localDate } from "@/lib/time";
import { PageTitle } from "@/components/ui";
import ReminderEditor, { type EditReminder } from "./ReminderEditor";

export const dynamic = "force-dynamic";

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dd = (d: string) => `${WD[new Date(`${d}T00:00:00`).getDay()]} ${d.slice(8)}/${d.slice(5, 7)}`;

/** Nhắc nhở – Bảng tin Bơ Sầu: danh sách + soạn + xem trước + ai đã xem */
export default async function RemindersPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string; tab?: string }> }) {
  await requirePerm("reminders");
  const sp = await searchParams;
  const today = localDate(new Date());
  const past = sp.tab === "past";
  const [list, stores] = await Promise.all([
    ShiftReminder.find(past ? { date: { $lt: today } } : { date: { $gte: today } })
      .sort(past ? { date: -1, createdAt: -1 } : { date: 1, createdAt: 1 })
      .limit(40)
      .lean(),
    Store.find({ active: { $ne: false } }).select("name").sort({ name: 1 }).lean(),
  ]);
  const storeName = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s+/i, "")]));
  const ORDER = { Sáng: 0, Chiều: 1, Tối: 2 } as Record<string, number>;
  if (!past) list.sort((a, b) => a.date.localeCompare(b.date) || (ORDER[a.shift] ?? 0) - (ORDER[b.shift] ?? 0));
  // ai nhận / ai đã xem
  const seenAll = await ShiftReminderSeen.find({ reminderId: { $in: list.map((r) => r._id) } }).select("reminderId userId").lean();
  const stats = new Map(
    await Promise.all(
      list.map(async (r) => {
        const targets = await reminderTargets({ date: r.date, shift: r.shift, storeIds: r.storeIds ?? [] });
        const seen = new Set(seenAll.filter((s) => String(s.reminderId) === String(r._id)).map((s) => String(s.userId)));
        return [String(r._id), { total: targets.length, seen: targets.filter((t) => seen.has(t.id)).length, targets: targets.map((t) => ({ name: t.name, seen: seen.has(t.id) })) }] as const;
      }),
    ),
  );
  const cur = sp.id && isValidObjectId(sp.id) ? list.find((r) => String(r._id) === sp.id) ?? (await ShiftReminder.findById(sp.id).lean()) : sp.new ? null : (list[0] ?? null);
  const edit: EditReminder | null = cur
    ? { id: String(cur._id), date: cur.date, shift: cur.shift, storeIds: (cur.storeIds ?? []).map(String), text: cur.text, level: cur.level === "IMPORTANT" ? "IMPORTANT" : "NORMAL", by: cur.createdBy ?? "" }
    : null;
  const curStat = cur ? (stats.get(String(cur._id)) ?? { total: 0, seen: 0, targets: [] }) : null;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PageTitle sub="Nhắc việc theo ngày + ca. Nhân viên ca đó thấy popup 30 phút trước giờ vào ca (ở bất kỳ trang nào), xem 1 lần rồi nằm ở Bảng tin trang Chấm công – hết ca tự ẩn.">
          Nhắc nhở – Bảng tin Bơ Sầu
        </PageTitle>
        <Link href="/admin/reminders?new=1" className="mb-4 rounded-xl border border-primary-dark bg-primary px-4 py-2 font-bold text-on-primary">
          + Nhắc nhở mới
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-line">
          <div className="flex gap-1.5 text-xs">
            <Link href="/admin/reminders" className={`rounded-full px-3 py-1 font-bold ${!past ? "bg-accent text-on-accent" : "bg-muted text-ink/70"}`}>
              Sắp tới
            </Link>
            <Link href="/admin/reminders?tab=past" className={`rounded-full px-3 py-1 font-bold ${past ? "bg-accent text-on-accent" : "bg-muted text-ink/70"}`}>
              Đã qua
            </Link>
          </div>
          {!list.length && <p className="py-4 text-center text-sm text-ink/60">{past ? "Chưa có nhắc nhở nào đã qua." : "Chưa có nhắc nhở sắp tới – bấm “+ Nhắc nhở mới”."}</p>}
          {list.map((r) => {
            const s = stats.get(String(r._id))!;
            const on = cur && String(cur._id) === String(r._id);
            return (
              <Link
                key={String(r._id)}
                href={`/admin/reminders?id=${r._id}${past ? "&tab=past" : ""}`}
                className={`block space-y-1.5 rounded-xl p-3 text-sm ${on ? "ring-2 ring-accent" : "ring-1 ring-line hover:bg-primary-light"}`}
              >
                <span className="flex items-center justify-between gap-2 text-xs">
                  <b className="text-accent">
                    {dd(r.date)} · Ca {r.shift}
                  </b>
                  {r.level === "IMPORTANT" ? (
                    <span className="rounded-full bg-bad-bg px-2 py-0.5 font-bold text-bad-fg">Quan trọng</span>
                  ) : r.date === today ? (
                    <span className="rounded-full bg-ok-bg px-2 py-0.5 font-bold text-good">Hôm nay</span>
                  ) : null}
                </span>
                <span className="line-clamp-2 block font-semibold">{r.text}</span>
                <span className="block text-xs text-ink/60">{(r.storeIds ?? []).length ? (r.storeIds ?? []).map((x: unknown) => storeName.get(String(x)) ?? "?").join(" · ") : "Tất cả cơ sở"}</span>
                {s.total > 0 ? (
                  <>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full bg-secondary" style={{ width: `${Math.round((s.seen / s.total) * 100)}%` }} />
                    </span>
                    <span className="block text-xs">
                      Đã xem <b>{s.seen}/{s.total}</b>
                    </span>
                  </>
                ) : (
                  <span className="block text-xs text-warn">Chưa có nhân viên nào được xếp ca này</span>
                )}
              </Link>
            );
          })}
        </section>
        <ReminderEditor
          key={edit?.id ?? "new"}
          initial={edit}
          today={today}
          stores={stores.map((s) => ({ id: String(s._id), name: s.name.replace(/^TBS\s+/i, "") }))}
          targets={curStat?.targets ?? []}
        />
      </div>
    </>
  );
}
