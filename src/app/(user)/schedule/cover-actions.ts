"use server";
import { track } from "@/lib/error-log";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { CoverRequest, Store, UserNotice } from "@/lib/models";
import { createCoverRequest, createSwapRequest } from "@/lib/cover";
import { localDate } from "@/lib/time";

export type CoverResult = { ok?: boolean; error?: string };

/** Nhân viên nhờ người khác làm hộ 1 ca của mình → gửi admin duyệt. */
async function requestCover__(shiftAssignmentId: string, toUserId: string, note: string): Promise<CoverResult> {
  try {
    const user = await requireActiveUser();
    const store = await Store.findById(user.storeId).select("timezone").lean();
    await createCoverRequest(user._id, shiftAssignmentId, toUserId, note.trim(), localDate(new Date(), store?.timezone || undefined));
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Nhân viên xin đổi 1 ca đã duyệt của mình lấy 1 ca đã duyệt của người khác → gửi admin duyệt. */
async function requestSwap__(myShiftId: string, theirShiftId: string, note: string): Promise<CoverResult> {
  try {
    const user = await requireActiveUser();
    const store = await Store.findById(user.storeId).select("timezone").lean();
    await createSwapRequest(user._id, myShiftId, theirShiftId, note.trim(), localDate(new Date(), store?.timezone || undefined));
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function cancelCover__(id: string): Promise<CoverResult> {
  try {
    const user = await requireActiveUser();
    const r = await CoverRequest.findOneAndUpdate(
      { _id: id, fromUserId: user._id, status: "PENDING" },
      { $set: { status: "CANCELLED", decidedAt: new Date(), decidedBy: "Người nhờ huỷ" } },
    );
    if (!r) return { error: "Yêu cầu đã được xử lý" };
    revalidatePath("/schedule");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Đánh dấu đã xem thông báo. */
async function dismissNotice__(id: string): Promise<CoverResult> {
  const user = await requireActiveUser();
  await UserNotice.updateOne({ _id: id, userId: user._id }, { $set: { readAt: new Date() } });
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function requestCover(...a: Parameters<typeof requestCover__>) { return track("Nhờ làm thay (NV)", "requestCover", () => requestCover__(...a)); }
export async function requestSwap(...a: Parameters<typeof requestSwap__>) { return track("Nhờ làm thay (NV)", "requestSwap", () => requestSwap__(...a)); }
export async function cancelCover(...a: Parameters<typeof cancelCover__>) { return track("Nhờ làm thay (NV)", "cancelCover", () => cancelCover__(...a)); }
export async function dismissNotice(...a: Parameters<typeof dismissNotice__>) { return track("Nhờ làm thay (NV)", "dismissNotice", () => dismissNotice__(...a)); }
