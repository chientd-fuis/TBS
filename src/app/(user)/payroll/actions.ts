"use server";
import { track } from "@/lib/error-log";
import { requireActiveUser } from "@/lib/guards";
import { explainMyPay } from "@/lib/pay-explain";
import { aiRemaining } from "@/lib/ai";

/** Nhân viên bấm "Vì sao lương tháng này là X?" – chỉ bảng lương đã công bố của chính mình. */
async function explainPayAction__(month: string): Promise<{ text?: string; error?: string; left?: number }> {
  const user = await requireActiveUser();
  try {
    const text = await explainMyPay(user, String(month ?? ""));
    const r = await aiRemaining("payExplain", `user:${user._id}`);
    return { text, left: Number.isFinite(r.left) ? r.left : undefined };
  } catch (e) {
    return { error: (e as Error).message || "Chưa giải thích được – thử lại sau" };
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function explainPayAction(...a: Parameters<typeof explainPayAction__>) { return track("Bảng lương (NV)", "explainPayAction", () => explainPayAction__(...a)); }
