import { ActionForm } from "@/components/ActionForm";
import { deviceAction } from "../../actions/people";

export function DeviceActions({ id, status }: { id: string; status: string }) {
  const btn = (op: string, label: string, variant: "secondary" | "outline" | "danger", confirm?: string) => (
    <ActionForm action={deviceAction} submitLabel={label} variant={variant} successText="" className="inline-block" confirm={confirm}>
      <input type="hidden" name="deviceRefId" value={id} />
      <input type="hidden" name="op" value={op} />
    </ActionForm>
  );
  return (
    <div className="flex flex-wrap gap-1">
      {status !== "APPROVED" && btn("approve", "Duyệt", "secondary")}
      {status === "PENDING" && btn("reject", "Từ chối", "outline")}
      {status === "APPROVED" && btn("revoke", "Thu hồi", "outline", "Thu hồi thiết bị này? Nhân viên sẽ không chấm công được trên máy này.")}
      {status !== "APPROVED" && btn("delete", "Xoá", "danger", "Xoá hẳn thiết bị để máy có thể gắn cho người khác?")}
    </div>
  );
}
