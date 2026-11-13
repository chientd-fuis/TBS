"use client";
import { useState } from "react";

/** Chọn 1 hoặc nhiều nhân viên (thưởng / phạt cùng lúc) – gửi lên dạng nhiều ô "userIds". */
export default function StaffMultiPick({ staff, defaultIds = [] }: { staff: { id: string; name: string; inactive?: boolean }[]; defaultIds?: string[] }) {
  const [sel, setSel] = useState<Set<string>>(new Set(defaultIds.filter(Boolean)));
  const [q, setQ] = useState("");
  const list = staff.filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()));
  const active = staff.filter((u) => !u.inactive);
  const toggle = (id: string) => setSel((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">
          Nhân viên <span className="font-normal text-ink/60">({sel.size} đã chọn)</span>
        </span>
        <span className="flex gap-2 text-xs">
          <button type="button" className="font-semibold text-accent underline" onClick={() => setSel(new Set(active.map((u) => u.id)))}>
            Chọn tất cả
          </button>
          {sel.size > 0 && (
            <button type="button" className="text-ink/60 underline" onClick={() => setSel(new Set())}>
              Bỏ chọn
            </button>
          )}
        </span>
      </div>
      {staff.length > 8 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên…" className="w-full rounded-xl border border-ink/15 px-3 py-1.5 text-sm" />}
      <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-ink/10 bg-card p-1.5">
        {list.map((u) => (
          <label key={u.id} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${sel.has(u.id) ? "bg-primary-light font-semibold" : "hover:bg-cream"}`}>
            <input type="checkbox" className="h-4 w-4 accent-secondary" checked={sel.has(u.id)} onChange={() => toggle(u.id)} />
            {u.name}
            {u.inactive && <span className="text-xs font-normal text-ink/50">(đã nghỉ)</span>}
          </label>
        ))}
        {!list.length && <p className="px-2 py-1 text-xs text-ink/50">Không có nhân viên</p>}
      </div>
      {[...sel].map((id) => (
        <input key={id} type="hidden" name="userIds" value={id} />
      ))}
      {sel.size > 1 && <p className="text-xs text-ink/70">Mỗi người nhận 1 khoản với cùng số tiền & nội dung.</p>}
    </div>
  );
}
