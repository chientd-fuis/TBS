"use server";
import { track } from "@/lib/error-log";
import { requireActiveUser } from "@/lib/guards";
import { askAssistant, type AssistantAnswer } from "@/lib/assistant";
import { aiRemaining } from "@/lib/ai";

/** Nhân viên hỏi Trợ lý cửa hàng. Trả về câu trả lời + số câu còn lại hôm nay. */
async function askStoreAssistant__(question: string): Promise<{ answer?: AssistantAnswer; error?: string; left?: number }> {
  const user = await requireActiveUser();
  try {
    const answer = await askAssistant(user, String(question ?? ""));
    const r = await aiRemaining("assistant", `user:${user._id}`);
    return { answer, left: Number.isFinite(r.left) ? r.left : undefined };
  } catch (e) {
    return { error: (e as Error).message || "Trợ lý đang bận, thử lại sau" };
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function askStoreAssistant(...a: Parameters<typeof askStoreAssistant__>) { return track("Trợ lý AI (NV)", "askStoreAssistant", () => askStoreAssistant__(...a)); }
