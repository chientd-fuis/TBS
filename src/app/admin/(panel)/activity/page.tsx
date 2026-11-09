import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { Card, PageTitle } from "@/components/ui";
import { GROUP_LABEL, type ActivityGroup } from "@/lib/activity";
import { ACTIVITY_DAYS } from "@/lib/models";
import { localDate } from "@/lib/time";
import ActivityFeed from "./ActivityFeed";
import SessionList from "./SessionList";
import { activityAdmins, activityDays, loadActivities, loadSessions } from "./data";

export const dynamic = "force-dynamic";

type SP = { day?: string; admin?: string; group?: string };

/** Admin Tổng: admin đang đăng nhập + lịch sử hoạt động 7 ngày của các admin (không gồm Admin Tổng). */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requirePerm("activity");
  const sp = await searchParams;
  const all = activityDays();
  const today = localDate(new Date());
  const day = sp.day === "7" || all.includes(sp.day ?? "") ? sp.day! : "2";
  const days = day === "7" ? all : day === "2" ? all.slice(0, 2) : [day];
  const group = sp.group && sp.group in GROUP_LABEL ? (sp.group as ActivityGroup) : undefined;
  const [rows, admins, sessions] = await Promise.all([loadActivities({ days, admin: sp.admin || undefined, group }), activityAdmins(), loadSessions()]);

  const href = (p: Partial<SP>) => {
    const q = new URLSearchParams();
    const m = { day, admin: sp.admin, group: sp.group, ...p };
    if (m.day && m.day !== "2") q.set("day", m.day);
    if (m.admin) q.set("admin", m.admin);
    if (m.group) q.set("group", m.group);
    const s = q.toString();
    return `/admin/activity${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean, label: string, to: string) => (
    <Link key={to + label} href={to} scroll={false} className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-secondary bg-secondary text-white" : "border-ink/15 bg-white text-ink/70 hover:bg-cream"}`}>
      {label}
    </Link>
  );

  return (
    <>
      <PageTitle sub={`Thao tác của các admin (không gồm Admin Tổng) – tự xoá sau ${ACTIVITY_DAYS} ngày`}>Hoạt động admin</PageTitle>
      {admin.kind === "OWNER" && (
        <Card title="Admin đang đăng nhập">
          <SessionList sessions={sessions} now={Date.now()} />
        </Card>
      )}
      <Card title={`Lịch sử hoạt động (${rows.length})`}>
        <div className="mb-3 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {chip(day === "2", "Hôm nay + hôm qua", href({ day: "2" }))}
            {chip(day === "7", `Cả ${ACTIVITY_DAYS} ngày`, href({ day: "7" }))}
            {all.map((d, i) => chip(day === d, i === 0 ? "Hôm nay" : i === 1 ? "Hôm qua" : `${d.slice(8)}/${d.slice(5, 7)}`, href({ day: d })))}
          </div>
          {admins.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {chip(!sp.admin, "Mọi admin", href({ admin: "" }))}
              {admins.map((a) => chip(sp.admin === a, a, href({ admin: a })))}
            </div>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {chip(!group, "Tất cả loại", href({ group: "" }))}
            {(Object.keys(GROUP_LABEL) as ActivityGroup[]).map((g) => chip(group === g, GROUP_LABEL[g], href({ group: g })))}
          </div>
        </div>
        <ActivityFeed rows={rows} today={today} empty="Không có hoạt động nào khớp bộ lọc" />
      </Card>
    </>
  );
}
