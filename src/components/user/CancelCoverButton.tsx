"use client";
import { useTransition } from "react";
import { cancelCover } from "@/app/(user)/schedule/cover-actions";
import { Spinner } from "@/components/ui";

export default function CancelCoverButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await cancelCover(id)))} className="inline-flex items-center gap-1 text-xs text-danger underline disabled:opacity-60">
      {pending && <Spinner className="h-3 w-3 border-2" />}
      {pending ? "Đang huỷ…" : "Huỷ"}
    </button>
  );
}
