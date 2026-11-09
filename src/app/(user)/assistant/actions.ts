"use server";
import { requireActiveUser } from "@/lib/guards";
import { askAssistant, type AssistantAnswer } from "@/lib/assistant";
import { aiRemaining } from "@/lib/ai";

/** Nhân viên hỏi Trợ lý cửa hàng. Trả về câu trả lời + số câu còn lại hôm nay. */
export async function askStoreAssistant(question: string): Promise<{ answer?: AssistantAnswer; error?: string; left?: number }> {
  const user = await requireActiveUser();
  try {
    const answer = await askAssistant(user, String(question ?? ""));
    const r = await aiRemaining("assistant", `user:${user._id}`);
    return { answer, left: Number.isFinite(r.left) ? r.left : undefined };
  } catch (e) {
    return { error: (e as Error).message || "Trợ lý đang bận, thử lại sau" };
  }
}
