import { isValidObjectId } from "mongoose";
import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { Store, User } from "@/lib/models";
import { vnd } from "@/lib/format";
import { Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createOfflineStaff } from "../../actions/people";
import EditEmployeeButton from "./EditEmployeeButton";
import EmployeeColumns from "./EmployeeColumns";
import { localDate } from "@/lib/time";
import { AutoFilterForm } from "@/components/AutoFilterForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "green" | "yellow" | "red" | "gray" }> = {
  ACTIVE: { label: "Đang làm", tone: "green" },
  PENDING: { label: "Chờ duyệt", tone: "yellow" },
  INACTIVE: { label: "Nghỉ việc", tone: "gray" },
  REJECTED: { label: "Từ chối", tone: "red" },
  NEW: { label: "Chưa đăng ký", tone: "gray" },
};

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<{ store?: string; status?: string; q?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find().sort({ name: 1 }).lean();
  const q: Record<string, unknown> = {};
  if (sp.store && isValidObjectId(sp.store)) q.storeId = sp.store; // link sai tham số → bỏ qua lọc (tránh lỗi 500)
  q.status = sp.status || { $in: ["ACTIVE", "PENDING"] };
  if (sp.q) {
    const re = sp.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escape ký tự đặc biệt khi tìm
    q.$or = [{ name: { $regex: re, $options: "i" } }, { email: { $regex: re, $options: "i" } }, { phone: { $regex: re } }];
  }
  const users = await User.find(q).sort({ name: 1 }).lean();
  const today = localDate(new Date());
  const storeName = new Map(stores.map((s) => [String(s._id), s.name]));
  return (
    <>
      <PageTitle>Nhân viên</PageTitle>
      <Card>
        <AutoFilterForm className="mb-3 grid gap-2 sm:grid-cols-[1fr_200px_220px]" >
          <Input type="search" name="q" placeholder="Tìm tên, email, SĐT" defaultValue={sp.q} />
          <Select name="store" defaultValue={sp.store}>
            <option value="">Tất cả cơ sở</option>
            {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
          </Select>
          <Select name="status" defaultValue={sp.status}>
            <option value="">Đang làm + chờ duyệt</option>
            <option value="ACTIVE">Đang làm</option>
            <option value="INACTIVE">Nghỉ việc</option>
            <option value="REJECTED">Từ chối</option>
          </Select>
        </AutoFilterForm>
        {users.length === 0 ? (
          <Empty>Không có nhân viên</Empty>
        ) : (
          <EmployeeColumns>
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Họ tên</th><th>Email</th><th>SĐT</th><th>Cơ sở</th><th className="text-right">Lương giờ</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={String(u._id)}>
                    <td className="font-semibold">{u.name || u.googleName}</td>
                    <td className="text-xs">{u.noLogin ? <Badge tone="gray">Không có tài khoản</Badge> : u.email}</td>
                    <td>{u.phone}</td>
                    <td>{storeName.get(String(u.storeId))}</td>
                    <td className="text-right">{vnd(u.hourlyWage)}</td>
                    <td><Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge></td>
                    <td className="whitespace-nowrap">
                      <EditEmployeeButton id={String(u._id)} name={u.name || u.googleName || ""} hourlyWage={u.hourlyWage || 0} today={today} />
                      <Link className="ml-1 text-sm text-accent underline" href={`/admin/employees/${u._id}`}>Chi tiết</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </EmployeeColumns>
        )}
      </Card>
      <Card title="➕ Thêm nhân viên không có tài khoản (VD đã nghỉ việc)">
        <p className="mb-2 text-xs text-ink/70">
          Dùng khi cần nhập chấm công / tính lương tháng cũ cho người chưa từng đăng nhập app (thường là đã nghỉ việc). Nhân viên này không đăng nhập được;
          nếu sau này họ dùng Gmail thì vào Chi tiết → <b>Chuyển sang tài khoản Gmail mới</b> để gộp dữ liệu.
        </p>
        <ActionForm action={createOfflineStaff} submitLabel="Thêm nhân viên" successText="Đã thêm" className="flex flex-wrap items-end gap-2">
          <Field label="Họ tên"><Input name="name" required className="!w-52" /></Field>
          <Field label="Cơ sở">
            <Select name="storeId" defaultValue={sp.store || String(stores[0]?._id ?? "")} required className="!w-44">
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Lương giờ (VND)"><Input name="hourlyWage" inputMode="numeric" required placeholder="VD 25000" className="!w-32 text-right" /></Field>
          <Field label="SĐT"><Input name="phone" className="!w-36" /></Field>
          <Field label="Trạng thái">
            <Select name="status" defaultValue="INACTIVE" className="!w-36">
              <option value="INACTIVE">Đã nghỉ việc</option>
              <option value="ACTIVE">Đang làm</option>
            </Select>
          </Field>
        </ActionForm>
      </Card>
    </>
  );
}
