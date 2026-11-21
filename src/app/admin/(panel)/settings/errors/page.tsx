import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { ErrorLog } from "@/lib/models";
import { ERROR_LOG_DAY_OPTIONS, errorLogDays } from "@/lib/error-log";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Input, PageTitle, Select } from "@/components/ui";
import { clearErrorLogs, saveErrorLogDays } from "../../../actions/errors";

export const dynamic = "force-dynamic";

const LIMIT = 300;
const SOURCE = { user: "Nhân viên", admin: "Admin", system: "Tự động", client: "Trình duyệt" } as const;
const RANGES = { "1h": 3_600_000, "24h": 86_400_000, "7d": 7 * 86_400_000, all: 0 } as const;

const fmt = (d?: Date | null) =>
  d
    ? new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d)
    : "";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Sp = { level?: string; src?: string; q?: string; range?: string };

/** Cài đặt → Log lỗi hệ thống: mọi lỗi nhân viên / admin gặp khi thao tác + lỗi tự động (Telegram, cron, AI…). Chỉ Admin Tổng. */
export default async function ErrorLogPage({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireOwner();
  await connectDB();
  const sp = await searchParams;
  const level = sp.level === "error" || sp.level === "warn" ? sp.level : "";
  const src = sp.src && sp.src in SOURCE ? sp.src : "";
  const range = (sp.range && sp.range in RANGES ? sp.range : "7d") as keyof typeof RANGES;
  const q = (sp.q ?? "").trim().slice(0, 100);

  const filter: Record<string, unknown> = {};
  if (level) filter.level = level;
  if (src) filter.source = src;
  if (RANGES[range]) filter.lastAt = { $gte: new Date(Date.now() - RANGES[range]) };
  if (q) {
    const r = new RegExp(esc(q), "i");
    filter.$or = [{ message: r }, { area: r }, { fn: r }, { actorName: r }, { actorEmail: r }, { path: r }];
  }
  const dayAgo = new Date(Date.now() - 86_400_000);
  const [rows, total, days, err24, warn24] = await Promise.all([
    ErrorLog.find(filter).sort({ lastAt: -1 }).limit(LIMIT).lean(),
    ErrorLog.countDocuments(filter),
    errorLogDays(),
    ErrorLog.countDocuments({ level: "error", lastAt: { $gte: dayAgo } }),
    ErrorLog.countDocuments({ level: "warn", lastAt: { $gte: dayAgo } }),
  ]);

  return (
    <>
      <PageTitle sub="Lỗi nhân viên / admin gặp khi thao tác, lỗi trang, lỗi AI, Telegram, chạy tự động… – để theo dõi và sửa kịp">
        <Link href="/admin/settings" className="text-sm font-normal underline">Cài đặt</Link> / Log lỗi hệ thống
      </PageTitle>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <Card>
          <div className="flex flex-wrap gap-3 text-sm">
            <span>24 giờ qua:</span>
            <Badge tone="red">{err24} lỗi hệ thống</Badge>
            <Badge tone="orange">{warn24} thao tác lỗi</Badge>
          </div>
          <p className="mt-2 text-xs text-ink/60">
            <b className="text-danger">Lỗi hệ thống</b> = app / máy chủ / AI / Telegram hỏng – cần xem. <b className="text-warn">Thao tác lỗi</b> = app từ chối thao tác (thiếu
            thông tin, sai dữ liệu, hết hạn phiên…) – xem nếu 1 người gặp lặp lại nhiều lần. Lỗi giống nhau trong 10 phút được gộp 1 dòng (×số lần).
          </p>
        </Card>
        <Card title="Tự xoá log sau">
          <ActionForm action={saveErrorLogDays} submitLabel="Lưu" successText="Đã lưu" className="flex flex-wrap items-end gap-2">
            <Select name="days" defaultValue={String(days)} aria-label="Số ngày giữ log">
              {[...new Set([...ERROR_LOG_DAY_OPTIONS, days])].sort((a, b) => a - b).map((d) => (
                <option key={d} value={d}>{d} ngày</option>
              ))}
            </Select>
          </ActionForm>
        </Card>
      </div>

      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <Select name="range" defaultValue={range} aria-label="Thời gian">
          <option value="1h">1 giờ qua</option>
          <option value="24h">24 giờ qua</option>
          <option value="7d">7 ngày qua</option>
          <option value="all">Tất cả</option>
        </Select>
        <Select name="level" defaultValue={level} aria-label="Mức">
          <option value="">Mọi mức</option>
          <option value="error">Lỗi hệ thống</option>
          <option value="warn">Thao tác lỗi</option>
        </Select>
        <Select name="src" defaultValue={src} aria-label="Ai gặp">
          <option value="">Mọi người</option>
          {Object.entries(SOURCE).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
        <div className="min-w-48 flex-1">
          <Input name="q" defaultValue={q} placeholder="Tìm nội dung, chức năng, tên người…" />
        </div>
        <button className="rounded-xl bg-secondary px-4 py-2 text-sm font-semibold text-white">Lọc</button>
        {(level || src || q || range !== "7d") && (
          <Link href="/admin/settings/errors" className="px-2 py-2 text-sm underline">Bỏ lọc</Link>
        )}
      </form>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink/70">
        <span>
          {total} dòng{total > LIMIT ? ` – hiện ${LIMIT} dòng mới nhất` : ""}
        </span>
        <ActionForm action={clearErrorLogs} submitLabel="Xoá tất cả log" variant="danger" successText="" confirm="Xoá toàn bộ log lỗi? Không khôi phục được." className="" />
      </div>

      {!rows.length ? (
        <Card>
          <Empty>Không có lỗi nào {q || level || src ? "khớp bộ lọc" : "trong khoảng này"} 🎉</Empty>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const id = String(r._id);
            const many = (r.count ?? 1) > 1;
            return (
              <div key={id} className={`rounded-xl border-l-4 bg-card p-3 text-sm shadow-sm ring-1 ring-line ${r.level === "error" ? "border-danger" : "border-warn"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={r.level === "error" ? "red" : "orange"}>{r.level === "error" ? "Lỗi hệ thống" : "Thao tác lỗi"}</Badge>
                  <Badge tone="gray">{SOURCE[(r.source ?? "system") as keyof typeof SOURCE] ?? r.source}</Badge>
                  {many && <Badge tone="pink">×{r.count}</Badge>}
                  <span className="font-semibold">{r.area || "—"}</span>
                  <span className="ml-auto text-xs whitespace-nowrap text-ink/60" title={many ? `Lần đầu ${fmt(r.createdAt)}` : undefined}>
                    {many ? `${fmt(r.createdAt)} → ${fmt(r.lastAt)}` : fmt(r.lastAt ?? r.createdAt)}
                  </span>
                </div>
                <p className="mt-1 font-medium break-words whitespace-pre-wrap text-ink">{r.message}</p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink/60">
                  {r.fn && <span>Hàm / API: <code>{r.fn}</code></span>}
                  {r.actorName && (
                    <span>
                      Người: <b>{r.actorName}</b>
                      {r.actorEmail && r.actorEmail !== r.actorName ? ` (${r.actorEmail})` : ""}
                    </span>
                  )}
                  {r.path && <span>Trang: <code className="break-all">{r.path}</code></span>}
                </div>
                {(r.detail || r.ua) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-accent">Chi tiết kỹ thuật</summary>
                    {r.ua && <p className="mt-1 text-xs break-all text-ink/60">Thiết bị: {r.ua}</p>}
                    {r.detail && <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-mute-bg p-2 text-[11px] leading-snug whitespace-pre-wrap">{r.detail}</pre>}
                  </details>
                )}
                <div className="mt-1 flex justify-end">
                  <ActionForm action={clearErrorLogs} submitLabel="Xoá" variant="ghost" successText="" className="" buttonClassName="!px-2 !py-0.5 text-xs">
                    <input type="hidden" name="id" value={id} />
                  </ActionForm>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
