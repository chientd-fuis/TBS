"use server";
import { revalidatePath } from "next/cache";
import { requireActiveUser } from "@/lib/guards";
import { CoverRequest, Store, UserNotice } from "@/lib/models";
import { createCoverRequest } from "@/lib/cover";
import { localDate } from "@/lib/time";

export type CoverResult = { ok?: boolean; error?: string };

/** Nhân viên nhờ người khác làm hộ 1 ca của mình → gửi admin duyệt. */
export async function requestCover(shiftAssignmentId: string, toUserId: string, note: string): Promise<CoverResult> {
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

export async function cancelCover(id: string): Promise<CoverResult> {
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
export async function dismissNotice(id: string): Promise<CoverResult> {
  const user = await requireActiveUser();
  await UserNotice.updateOne({ _id: id, userId: user._id }, { $set: { readAt: new Date() } });
  revalidatePath("/", "layout");
  return { ok: true };
}
