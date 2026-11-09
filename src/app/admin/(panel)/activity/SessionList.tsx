"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, MonitorSmartphone } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { revokeAdminSession } from "../../actions/activity";
import type { SessionRow } from "./data";
import { vnTime } from "@/lib/activity";

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} giờ trước` : `${Math.round(h / 24)} ngày trước`;
};
const vn = (iso: string) => vnTime(iso);

/** Admin Tổng: các phiên admin đang đăng nhập + đăng xuất từng phiên / tất cả. */
export default function SessionList({ sessions, now }: { sessions: SessionRow[]; now: number }) {
  const router = useRouter();
  const [ask, setAsk] = useState<SessionRow | "ALL" | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const revoke = () =>
    start(async () => {
      if (!ask) return;
      const r = await revokeAdminSession(ask === "ALL" ? "ALL" : ask.sid);
      if (r.error) setError(r.error);
      setAsk(null);
      router.refresh();
    });
  const online = sessions.filter((s) => s.online).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-ink/70">
          <b className="text-secondary-dark">{online}</b> đang online · {sessions.length} phiên còn hiệu lực
        </span>
        {sessions.length > 1 && (
          <Button variant="ghost" className="px-2 py-1 text-xs text-danger" onClick={() => setAsk("ALL")}>
            <LogOut size={14} /> Đăng xuất tất cả
          </Button>
        )}
      </div>
      {error && <Alert tone="red">{error}</Alert>}
      {!sessions.length ? (
        <p className="py-3 text-center text-sm text-ink/50">Không có admin nào đang đăng nhập</p>
      ) : (
        <ul className="divide-y divide-ink/5">
          {sessions.map((s) => (
            <li key={s.sid} className="flex items-center gap-3 py-2 text-sm">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.online ? "bg-secondary" : "bg-ink/20"}`} title={s.online ? "Đang online" : "Không hoạt động"} />
              <div className="min-w-0 flex-1">
                <p>
                  <b>{s.name}</b> <span className={`text-xs ${s.online ? "font-semibold text-secondary-dark" : "text-ink/50"}`}>{s.online ? "đang online" : `hoạt động ${ago(s.lastSeenAt, now)}`}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
                  <MonitorSmartphone size={12} /> {s.device}
                  {s.ip && <span>· IP {s.ip}</span>}
                  <span>· đăng nhập {vn(s.createdAt)}</span>
                </p>
              </div>
              <Button variant="outline" className="shrink-0 px-2 py-1 text-xs" disabled={pending} onClick={() => setAsk(s)}>
                <LogOut size={14} /> Đăng xuất
              </Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!ask}
        danger
        title={ask === "ALL" ? "Đăng xuất tất cả admin?" : `Đăng xuất ${ask?.name}?`}
        confirmLabel={pending ? "Đang xử lý…" : "Đăng xuất"}
        busy={pending}
        onCancel={() => setAsk(null)}
        onConfirm={revoke}
      >
        <p>{ask === "ALL" ? "Mọi admin đang đăng nhập" : "Admin này"} sẽ bị thoát ngay ở lần thao tác tiếp theo và phải nhập lại mật khẩu.</p>
        <p className="text-xs text-ink/60">Nếu nghi lộ mật khẩu, hãy đổi mật khẩu admin trong Cài đặt.</p>
      </ConfirmDialog>
    </div>
  );
}
