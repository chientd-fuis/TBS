"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { declareWeekOff } from "@/app/(user)/schedule/actions";

/** Nhân viên báo nghỉ cả tuần (đóng yêu cầu đăng ký ca của admin). */
export default function WeekOffButton({ weekStart }: { weekStart: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      className="text-xs text-ink/70 underline disabled:opacity-50"
      onClick={() => {
        if (!confirm("Báo admin là bạn KHÔNG đi làm tuần này?")) return;
        start(async () => {
          const r = await declareWeekOff(weekStart);
          if (r.error) alert(r.error);
          router.refresh();
        });
      }}
    >
      Tuần này tôi nghỉ
    </button>
  );
}
