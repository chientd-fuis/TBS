"use server";
import { track } from "@/lib/error-log";
import { revalidatePath } from "next/cache";
import { assertPerm } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { resolveUnpaid } from "@/lib/unpaid-order";
import { errMsg, str, type FormState } from "./types";

/**
 * Yêu cầu → 🧾 Đơn chưa thanh toán (quyền Doanh thu).
 *  Cảnh báo (OPEN):      approve = Khách đã trả · reject = Bỏ cảnh báo (không phải đơn nợ)
 *  Yêu cầu phạt (ESCALATED): approve = Duyệt ghi phạt (số "amount") · reject = Không phạt · op=paid = Khách đã trả
 */
async function resolveUnpaidAction__(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertPerm("revenue");
    const id = str(fd.get("id"));
    const stage = str(fd.get("stage")); // OPEN | ESCALATED
    const op = str(fd.get("op")) || "approve";
    const reply = str(fd.get("reply")).slice(0, 200);
    const by = adminActor(admin).name;
    const kind =
      op === "paid" ? "paid" : stage === "ESCALATED" ? (op === "reject" ? "waive" : "penalize") : op === "reject" ? "dismiss" : "paid";
    const amount = Number(str(fd.get("amount")).replace(/[^\d]/g, "")) || 0;
    const fined = await resolveUnpaid(id, kind, by, reply, amount);
    await audit(adminActor(admin), `unpaid.${kind}`, { type: "UnpaidOrder", id }, null, { reply, fined });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ---- Log lỗi hệ thống (lib/error-log.ts): mọi lỗi của các thao tác trong file này ---- */
export async function resolveUnpaidAction(...a: Parameters<typeof resolveUnpaidAction__>) { return track("Admin › Đơn chưa thanh toán", "resolveUnpaidAction", () => resolveUnpaidAction__(...a)); }
