import Link from "next/link";
import { isValidObjectId } from "mongoose";
import { requireOwner } from "@/lib/guards";
import { AdminAccount, Announcement, AnnouncementSeen, Store, User } from "@/lib/models";
import { localDate } from "@/lib/time";
import { PageTitle } from "@/components/ui";
import AnnEditor, { type EditAnn } from "./AnnEditor";

export const dynamic = "force-dynamic";

const ST: Record<string, [string, string]> = {
  PUBLISHED: ["Đang hiện", "bg-ok-bg text-good"],
  DRAFT: ["Bản nháp", "bg-mute-bg text-mute-fg"],
  OFF: ["Đã tắt", "bg-bad-bg text-bad-fg"],
};
const AUD: Record<string, string> = { USER: "Nhân viên", ADMIN: "Admin", ALL: "Nhân viên + Admin" };

/** Cài đặt → Có gì mới: danh sách + soạn + xem trước + ai đã xem (Admin Tổng) */
export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<{ id?: string; new?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const [list, stores] = await Promise.all([
    Announcement.find().sort({ status: 1, date: -1, createdAt: -1 }).limit(50).lean(),
    Store.find({ active: { $ne: false } }).select("name").sort({ name: 1 }).lean(),
  ]);
  // người cần xem: nhân viên đang làm (theo cơ sở) / admin đang hoạt động
  const [users, admins] = await Promise.all([
    User.find({ status: "ACTIVE", noLogin: { $ne: true } }).select("name storeId joinedAt registeredAt").lean(),
    AdminAccount.find({ status: "ACTIVE" }).select("email name").lean(),
  ]);
  const seen = await AnnouncementSeen.find({ announcementId: { $in: list.map((a) => a._id) } }).select("announcementId who version").lean();
  const stat = new Map(
    list.map((a) => {
      const who = new Set(seen.filter((x) => String(x.announcementId) === String(a._id) && (x.version ?? 1) >= (a.version ?? 1)).map((x) => x.who));
      const targets: { key: string; name: string }[] = [];
      if (a.audience !== "ADMIN")
        for (const u of users) {
          if ((a.storeIds ?? []).length && !(a.storeIds ?? []).some((s: unknown) => String(s) === String(u.storeId))) continue;
          const since = u.joinedAt ?? u.registeredAt;
          if (a.publishedAt && since && since > a.publishedAt) continue; // vào làm sau ngày đăng → không cần xem
          targets.push({ key: `user:${u._id}`, name: u.name || "?" });
        }
      if (a.audience !== "USER") for (const ad of admins) targets.push({ key: `admin:${ad.email.toLowerCase()}`, name: `Admin ${ad.name}` });
      const notSeen = targets.filter((t) => !who.has(t.key));
      return [String(a._id), { total: targets.length, seen: targets.length - notSeen.length, notSeen: notSeen.map((t) => t.name) }] as const;
    }),
  );
  const cur = sp.id && isValidObjectId(sp.id) ? list.find((a) => String(a._id) === sp.id) : sp.new ? null : (list[0] ?? null);
  const edit: EditAnn | null = cur
    ? {
        id: String(cur._id),
        title: cur.title,
        date: cur.date,
        desc: cur.desc ?? "",
        points: cur.points ?? [],
        color: cur.color ?? "#fccc18",
        image: cur.image ?? "",
        ctaHref: cur.ctaHref ?? "",
        audience: (cur.audience ?? "USER") as EditAnn["audience"],
        storeIds: (cur.storeIds ?? []).map(String),
        status: cur.status ?? "DRAFT",
        version: cur.version ?? 1,
      }
    : null;
  const st = cur ? stat.get(String(cur._id)) : undefined;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <PageTitle sub="Popup giới thiệu tính năng mới – hiện 1 lần cho người chưa xem; nhiều bản chưa xem → gộp thành slide">Có gì mới</PageTitle>
        <Link href="/admin/settings/announcements?new=1" className="mb-4 rounded-xl border border-primary-dark bg-primary px-4 py-2 font-bold text-on-primary">
          + Bản giới thiệu mới
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="space-y-2 rounded-2xl bg-card p-3 ring-1 ring-line">
          <b className="text-accent">Danh sách</b>
          {!list.length && <p className="text-sm text-ink/60">Chưa có bản nào – bấm “+ Bản giới thiệu mới”.</p>}
          {list.map((a) => {
            const s = stat.get(String(a._id))!;
            const [label, cls] = ST[a.status ?? "DRAFT"];
            const on = cur && String(cur._id) === String(a._id);
            return (
              <Link
                key={String(a._id)}
                href={`/admin/settings/announcements?id=${a._id}`}
                className={`block space-y-1.5 rounded-xl p-3 text-sm ${on ? "ring-2 ring-accent" : "ring-1 ring-line hover:bg-primary-light"}`}
              >
                <span className="flex items-start justify-between gap-2">
                  <b className="min-w-0">{a.title}</b>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
                </span>
                <span className="block text-xs text-ink/60">
                  {a.date.slice(8)}/{a.date.slice(5, 7)} · {AUD[a.audience ?? "USER"]}
                  {(a.storeIds ?? []).length ? ` · ${(a.storeIds ?? []).length} cơ sở` : ""}
                  {(a.version ?? 1) > 1 ? ` · đã hiện lại ${(a.version ?? 1) - 1} lần` : ""}
                </span>
                {a.status !== "DRAFT" && s.total > 0 && (
                  <>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full bg-secondary" style={{ width: `${Math.round((s.seen / s.total) * 100)}%` }} />
                    </span>
                    <span className="block text-xs">
                      Đã xem <b>{s.seen}/{s.total}</b>
                    </span>
                  </>
                )}
              </Link>
            );
          })}
        </section>
        <AnnEditor
          key={edit?.id ?? "new"}
          initial={edit}
          today={localDate(new Date())}
          stores={stores.map((s) => ({ id: String(s._id), name: s.name }))}
          notSeen={st?.notSeen ?? []}
        />
      </div>
    </>
  );
}
