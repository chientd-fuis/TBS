"use client";
import { useTransition } from "react";
import { X } from "lucide-react";
import { dismissNotice } from "@/app/(user)/schedule/cover-actions";

export default function DismissNotice({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await dismissNotice(id)))} className="shrink-0 rounded-full p-0.5 opacity-70 hover:opacity-100" aria-label="Đã xem">
      <X size={16} />
    </button>
  );
}
