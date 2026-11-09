import { AuditLog } from "./models";

export type Actor = {
  kind: "OWNER" | "ADMIN" | "USER" | "SYSTEM";
  name: string;
  sid?: string;
  /** nhân viên được cấp quyền quản lý: thao tác ghi vào nhật ký của cơ sở này (Tổng quan) */
  staff?: { userId: string; storeId: string };
};

export async function audit(
  actor: Actor,
  action: string,
  target?: { type: string; id?: string },
  before?: unknown,
  after?: unknown,
) {
  try {
    await AuditLog.create({
      actorKind: actor.kind,
      actorName: actor.name,
      action,
      targetType: target?.type,
      targetId: target?.id,
      before,
      after,
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
  // nhân viên quản lý → nhật ký thao tác ở Tổng quan cơ sở
  if (actor.kind === "USER" && actor.staff) {
    const { recordStaffActivity } = await import("./activity-server");
    await recordStaffActivity({ name: actor.name, ...actor.staff }, action, target, before, after);
  }
  // admin (không phải Admin Tổng) → thêm vào lịch sử hoạt động 7 ngày
  if (actor.kind === "ADMIN") {
    const { recordActivity } = await import("./activity-server");
    await recordActivity(actor, action, target, before, after);
  }
}
