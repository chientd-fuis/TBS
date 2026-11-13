"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { WeekGrid, type GridTpl } from "@/components/WeekGrid";
import { cn } from "@/lib/format";
import { saveShiftRequests } from "../actions";

type St = "PENDING" | "APPROVED" | "REJECTED";

export default function RegisterForm({
  weekStart,
  days,
  templates,
  existing,
}: {
  weekStart: string;
  days: string[];
  templates: GridTpl[];
  existing: { key: string; status: St }[];
}) {
  const router = useRouter();
  // chỉ xét các ô có trên bảng (ca đang hoạt động của cơ sở × 7 ngày) – bỏ ca hỗ trợ cơ sở khác, ca mẫu đã tắt
  const visible = useMemo(() => new Set(days.flatMap((d) => templates.map((t) => `${d}|${t.id}`))), [days, templates]);
  const mine = useMemo(() => existing.filter((e) => visible.has(e.key)), [existing, visible]);
  const status = useMemo(() => new Map(mine.map((e) => [e.key, e.status])), [mine]);
  const [sel, setSel] = useState<Set<string>>(() => new Set(mine.filter((e) => e.status !== "REJECTED").map((e) => e.key)));
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toggle = (k: string) => {
    if (status.get(k) === "APPROVED") return; // ca đã duyệt: liên hệ admin để huỷ
    const n = new Set(sel);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setSel(n);
  };
  const submit = () =>
    start(async () => {
      const r = await saveShiftRequests(weekStart, [...sel]);
      setMsg(r.error ? { tone: "red", text: r.error } : { tone: "green", text: r.message || "Đã gửi" });
      if (!r.error) router.refresh();
    });

  const changed = useMemo(() => {
    const before = new Set(mine.filter((e) => e.status !== "REJECTED").map((e) => e.key));
    return before.size !== sel.size || [...sel].some((k) => !before.has(k));
  }, [mine, sel]);
  const picked = [...sel].filter((k) => status.get(k) !== "APPROVED").length; // ca nhân viên tự chọn (mới / chờ duyệt)
  const approved = [...sel].filter((k) => status.get(k) === "APPROVED").length;

  return (
    <div className="space-y-3">
      <WeekGrid
        templates={templates}
        days={days}
        renderCell={(t, d) => {
          const k = `${d}|${t.id}`;
          const st = status.get(k);
          const on = sel.has(k);
          return (
            <button
              type="button"
              onClick={() => toggle(k)}
              className={cn(
                "flex h-full min-h-16 w-full flex-col items-center justify-center rounded-md text-xs font-bold transition",
                st === "APPROVED" && "cursor-default bg-secondary text-white",
                st !== "APPROVED" && on && "bg-late-strong text-warn ring-2 ring-warn",
                st !== "APPROVED" && !on && "bg-card/40 text-ink/40 hover:bg-card/80",
              )}
            >
              {st === "APPROVED" ? (
                <>✓ Đã duyệt</>
              ) : on ? (
                <>
                  <Check size={16} />
                  {st === "PENDING" ? "Chờ duyệt" : "Muốn làm"}
                </>
              ) : st === "REJECTED" ? (
                <span className="text-danger line-through">Bị từ chối</span>
              ) : (
                "+"
              )}
            </button>
          );
        }}
      />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">
          Đã chọn <b>{picked}</b> ca
          {approved > 0 && <span className="text-ink/60"> · {approved} ca đã duyệt</span>}
        </span>
        <Button onClick={submit} disabled={pending || !changed} className="px-6">
          {pending && <Loader2 size={16} className="animate-spin" />} Gửi đăng ký
        </Button>
      </div>
      <p className="text-xs text-ink/60">Ca đã được duyệt không tự bỏ được – liên hệ admin nếu cần đổi.</p>
    </div>
  );
}
