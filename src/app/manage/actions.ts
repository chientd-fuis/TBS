"use server";
import { revalidatePath } from "next/cache";
import { BonusPenalty, CoverRequest, User } from "@/lib/models";
import { staffManager } from "@/lib/staff-guard";
import { audit } from "@/lib/audit";
import { assertNotLocked } from "@/lib/attendance";
import { approveCover, rejectCover } from "@/lib/cover";
import { evalMoneyExpr } from "@/lib/revenue";

/* Thao tác của nhân viên được admin cấp quyền quản lý – mọi thao tác ghi nhật ký ở Tổng quan cơ sở (lib/audit.ts). */

export type FormState = { ok?: boolean; error?: string } | null;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim();
const fail = (e: unknown): FormState => ({ error: (e as Error).message || "Lỗi hệ thống" });
const done = () => {
  revalidatePath("/manage", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true } as const;
};

function readBp(fd: FormData) {
  const date = str(fd.get("date"));
  const amt = evalMoneyExpr(str(fd.get("amountVnd")));
  const content = str(fd.get("content")).slice(0, 300);
  if (!DATE_RE.test(date)) throw new Error("Chọn ngày áp dụng");
  if (!amt.ok || amt.value <= 0) throw new Error("Số tiền phải > 0");
  if (content.length < 3) throw new Error("Nhập nội dung");
  return { kind: str(fd.get("kind")) === "BONUS" ? ("BONUS" as const) : ("PENALTY" as const), date, month: date.slice(0, 7), amountVnd: Math.round(amt.value), content };
}

export async function staffCreateBonus(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const target = await User.findOne({ _id: str(fd.get("userId")), status: "ACTIVE" }).select("storeId name").lean();
    if (!target?.storeId) return { error: "Chọn nhân viên" };
    const { user, actor } = await staffManager("bonus", String(target.storeId));
    if (String(target._id) === String(user._id)) return { error: "Không tự tạo thưởng / phạt cho chính mình" };
    const v = readBp(fd);
    await assertNotLocked(target.storeId, v.month);
    const bp = await BonusPenalty.create({ userId: target._id, storeId: target.storeId, ...v, createdBy: actor.name, createdByUserId: user._id });
    await audit(actor, "bonusPenalty.create", { type: "BonusPenalty", id: String(bp._id) }, null, { userId: String(target._id), storeId: String(target.storeId), ...v });
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Chỉ sửa / xoá được khoản do chính mình tạo. */
async function ownBp(fd: FormData) {
  const bp = await BonusPenalty.findById(str(fd.get("id")));
  if (!bp) throw new Error("Không tìm thấy");
  const s = await staffManager("bonus", String(bp.storeId));
  if (String(bp.createdByUserId) !== String(s.user._id)) throw new Error("Chỉ sửa / xoá được khoản thưởng / phạt do bạn tạo");
  return { bp, ...s };
}

export async function staffUpdateBonus(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { bp, actor } = await ownBp(fd);
    const v = readBp(fd);
    await assertNotLocked(bp.storeId, bp.month);
    await assertNotLocked(bp.storeId, v.month);
    const before = bp.toObject();
    bp.set(v);
    await bp.save();
    await audit(actor, "bonusPenalty.update", { type: "BonusPenalty", id: String(bp._id) }, before, bp.toObject());
    return done();
  } catch (e) {
    return fail(e);
  }
}

export async function staffDeleteBonus(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { bp, actor } = await ownBp(fd);
    await assertNotLocked(bp.storeId, bp.month);
    await audit(actor, "bonusPenalty.delete", { type: "BonusPenalty", id: String(bp._id) }, bp.toObject(), null);
    await bp.deleteOne();
    return done();
  } catch (e) {
    return fail(e);
  }
}

/** Duyệt / từ chối nhờ làm hộ – đổi ca ở cơ sở được giao (không tự duyệt yêu cầu có mình trong đó). */
export async function staffResolveCover(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const id = str(fd.get("id"));
    const r = await CoverRequest.findById(id).lean();
    if (!r || r.status !== "PENDING") return { error: "Yêu cầu đã được xử lý" };
    const { user, actor } = await staffManager("cover", String(r.storeId));
    if (r.toStoreId && String(r.toStoreId) !== String(r.storeId)) await staffManager("cover", String(r.toStoreId)); // đổi ca 2 cơ sở → phải quản lý cả 2
    if ([String(r.fromUserId), String(r.toUserId)].includes(String(user._id))) return { error: "Không tự duyệt yêu cầu của chính mình – nhờ admin / người khác duyệt" };
    const op = str(fd.get("op"));
    const reply = str(fd.get("reply")).slice(0, 200);
    const out = op === "approve" ? await approveCover(id, actor.name, reply) : await rejectCover(id, actor.name, reply);
    await audit(actor, op === "approve" ? "cover.approve" : "cover.reject", { type: "CoverRequest", id }, null, { status: out.status, reply });
    revalidatePath("/schedule");
    return done();
  } catch (e) {
    return fail(e);
  }
}
