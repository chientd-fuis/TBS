"use server";
import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { approveCover, rejectCover } from "@/lib/cover";
import { errMsg, str, type FormState } from "./types";

/** Duyệt / từ chối yêu cầu nhờ làm hộ ca. */
export async function resolveCover(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    const actor = adminActor(admin);
    const id = str(fd.get("id"));
    const reply = str(fd.get("reply"));
    const op = str(fd.get("op"));
    const r = op === "approve" ? await approveCover(id, actor.name, reply) : await rejectCover(id, actor.name, reply);
    await audit(actor, op === "approve" ? "cover.approve" : "cover.reject", { type: "CoverRequest", id }, null, { status: r.status, reply });
    revalidatePath("/admin", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
