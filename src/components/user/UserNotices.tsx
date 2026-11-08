import Link from "next/link";
import type { Types } from "mongoose";
import { Bell } from "lucide-react";
import { UserNotice } from "@/lib/models";
import DismissNotice from "./DismissNotice";

const TONE = {
  green: "bg-[#e3f3e7] text-secondary-dark ring-secondary/40",
  orange: "bg-[#fff4e5] text-warn ring-warn/40",
  red: "bg-[#fde2e2] text-danger ring-danger/40",
  blue: "bg-[#dbeafe] text-[#1e40af] ring-[#93c5fd]",
} as const;

/** Thông báo chưa xem (VD được nhờ làm hộ ca) – hiện đầu mọi màn hình nhân viên. */
export default async function UserNotices({ userId }: { userId: Types.ObjectId }) {
  const list = await UserNotice.find({ userId, readAt: null }).sort({ createdAt: -1 }).limit(5).lean();
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      {list.map((n) => (
        <div key={String(n._id)} className={`flex items-start gap-2 rounded-2xl p-3 text-sm ring-1 ${TONE[(n.tone ?? "blue") as keyof typeof TONE]}`}>
          <Bell size={18} className="mt-0.5 shrink-0" />
          <p className="min-w-0 flex-1">
            {n.text}
            {n.link && (
              <>
                {" "}
                <Link href={n.link} className="font-semibold underline">Xem lịch</Link>
              </>
            )}
          </p>
          <DismissNotice id={String(n._id)} />
        </div>
      ))}
    </div>
  );
}
