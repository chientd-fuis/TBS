import { requireActiveUser } from "@/lib/guards";
import { aiRemaining } from "@/lib/ai";
import { geminiConfigured } from "@/lib/ocr";
import AssistantChat from "./AssistantChat";

export const dynamic = "force-dynamic";

/** Trợ lý cửa hàng – nhân viên hỏi nội quy, quản lý, bảo quản, nguyên liệu, chốt ca, chấm công. */
export default async function AssistantPage() {
  const user = await requireActiveUser();
  const r = await aiRemaining("assistant", `user:${user._id}`);
  return (
    <>
      <h1 className="text-lg font-bold text-accent">Trợ lý cửa hàng</h1>
      <AssistantChat enabled={r.enabled && geminiConfigured()} left={Number.isFinite(r.left) ? r.left : null} limit={r.limit} />
    </>
  );
}
