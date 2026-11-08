"use client";
import { useTransition } from "react";
import { cancelCover } from "@/app/(user)/schedule/cover-actions";

export default function CancelCoverButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await cancelCover(id)))} className="text-xs text-danger underline disabled:opacity-50">
      {pending ? "Đang huỷ…" : "Huỷ"}
    </button>
  );
}
