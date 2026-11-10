import { ActionForm } from "@/components/ActionForm";
import { deviceAction } from "../../actions/people";

/** stack: xếp dọc (cột cuối bảng Thiết bị); không stack: xếp ngang (trang nhân viên). Các nút luôn rộng bằng nhau. */
export function DeviceActions({ id, status, stack = true }: { id: string; status: string; stack?: boolean }) {
  const btn = (op: string, label: string, variant: "secondary" | "outline" | "danger", confirm?: string) => (
    <ActionForm action={deviceAction} submitLabel={label} variant={variant} successText="" className={stack ? "w-full" : "w-24"} buttonClassName="w-full whitespace-nowrap" confirm={confirm}>
      <input type="hidden" name="deviceRefId" value={id} />
      <input type="hidden" name="op" value={op} />
    </ActionForm>
  );
  return (
    <div className={stack ? "flex w-24 flex-col gap-1.5" : "flex flex-wrap gap-1.5"}>
      {status !== "APPROVED" && btn("approve", "Duyệt", "secondary")}
      {status === "PENDING" && btn("reject", "Từ chối", "outline")}
      {status === "APPROVED" && btn("revoke", "Thu hồi", "outline", "Thu hồi thiết bị này? Nhân viên sẽ không chấm công được trên máy này.")}
      {status !== "APPROVED" && btn("delete", "Xoá", "danger", "Xoá hẳn thiết bị để máy có thể gắn cho người khác?")}
    </div>
  );
}
