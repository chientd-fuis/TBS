"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { declareWeekOff } from "@/app/(user)/schedule/actions";
import { Spinner } from "@/components/ui";

/** Nhân viên báo nghỉ cả tuần (đóng yêu cầu đăng ký ca của admin). */
export default function WeekOffButton({ weekStart }: { weekStart: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className="inline-flex items-center gap-1 text-xs text-ink/70 underline disabled:opacity-60"
      onClick={() => {
        if (!confirm("Báo admin là bạn KHÔNG đi làm tuần này?")) return;
        start(async () => {
          const r = await declareWeekOff(weekStart);
          if (r.error) alert(r.error);
          router.refresh();
        });
      }}
    >
      {pending && <Spinner className="h-3 w-3 border-2" />}
      {pending ? "Đang gửi…" : "Tuần này tôi nghỉ"}
    </button>
  );
}
