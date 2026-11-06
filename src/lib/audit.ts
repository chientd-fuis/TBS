import { AuditLog } from "./models";

export type Actor = { kind: "OWNER" | "ADMIN" | "USER" | "SYSTEM"; name: string };

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
}
