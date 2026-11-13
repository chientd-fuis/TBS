import { isValidObjectId } from "mongoose";
import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdminAccount, Store, User } from "@/lib/models";
import { vnd } from "@/lib/format";
import { Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { createAdminStaff, createOfflineStaff } from "../../actions/people";
import { PayTermsFields } from "@/components/PayTermsFields";
import { isOwnerEmail } from "@/lib/auth";
import EditEmployeeButton from "./EditEmployeeButton";
import EmployeeColumns from "./EmployeeColumns";
import { localDate, localMonth, viDate } from "@/lib/time";
import { probationEnd } from "@/lib/probation";
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
  const admin = await requireAdmin();
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
  // Admin Tổng: các admin chưa có hồ sơ nhân viên → tạo để admin có lương trong bảng lương
  const isOwner = admin.kind === "OWNER";
  const adminChoices: { email: string; name: string }[] = [];
  if (isOwner) {
    const accs = await AdminAccount.find({ status: { $ne: "BLOCKED" } }).select("email name").sort({ name: 1 }).lean();
    const all = [...(admin.email && isOwnerEmail(admin.email) ? [{ email: admin.email, name: "Admin Tổng" }] : []), ...accs.map((a) => ({ email: a.email, name: a.name }))];
    const linked = new Set((await User.find({ email: { $in: all.map((a) => a.email) }, adminStaff: true }).select("email").lean()).map((u) => u.email));
    adminChoices.push(...all.filter((a) => !linked.has(a.email)));
  }
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
          <div className="mt-3 overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Họ tên</th><th>Email</th><th>SĐT</th><th>Cơ sở</th><th className="text-right">Lương</th><th>Trạng thái</th><th></th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={String(u._id)}>
                    <td className="font-semibold">
                      {u.name || u.googleName}
                      {(u.adminStaff || u.payType === "FULLTIME" || u.probation) && (
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {u.adminStaff && <Badge tone="pink">Admin</Badge>}
                          {u.payType === "FULLTIME" && <Badge tone="blue">Full-time</Badge>}
                          {u.probation && (
                            <span className="rounded-full bg-[#f3e1fa] px-2 py-0.5 text-xs font-semibold text-[#7e3a9c]">
                              Thử việc{u.probationStart ? ` đến ${viDate(probationEnd(u.probationStart))}` : ""}
                            </span>
                          )}
                          {u.probation && u.trialStage === "ON" && <Badge tone="pink">Đang 3 ca thử việc</Badge>}
                          {u.probation && u.trialStage === "PENDING" && <Badge tone="orange">Chờ nhận / không nhận</Badge>}
                          {u.probation && u.probationReview && <Badge tone="red">Cần xem xét</Badge>}
                        </span>
                      )}
                    </td>
                    <td className="text-xs">{u.noLogin ? <Badge tone="gray">Không có tài khoản</Badge> : u.email}</td>
                    <td>{u.phone}</td>
                    <td>{storeName.get(String(u.storeId))}</td>
                    <td className="whitespace-nowrap text-right">
                      {u.payType === "FULLTIME" ? <>{vnd(u.monthlySalary)}<span className="text-xs text-ink/60">/tháng</span><div className="text-xs text-ink/60">nghỉ có lương {u.paidLeaveDays || 0} ngày</div></> : <>{vnd(u.hourlyWage)}<span className="text-xs text-ink/60">/giờ</span></>}
                    </td>
                    <td><Badge tone={STATUS[u.status].tone}>{STATUS[u.status].label}</Badge></td>
                    <td className="whitespace-nowrap">
                      <EditEmployeeButton
                        id={String(u._id)}
                        name={u.name || u.googleName || ""}
                        hourlyWage={u.hourlyWage || 0}
                        payType={u.payType === "FULLTIME" ? "FULLTIME" : "HOURLY"}
                        monthlySalary={u.monthlySalary || 0}
                        paidLeaveDays={u.paidLeaveDays || 0}
                        today={today}
                      />
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
          <PayTermsFields />
          <Field label="SĐT"><Input name="phone" className="!w-36" /></Field>
          <Field label="Trạng thái">
            <Select name="status" defaultValue="INACTIVE" className="!w-36">
              <option value="INACTIVE">Đã nghỉ việc</option>
              <option value="ACTIVE">Đang làm</option>
            </Select>
          </Field>
        </ActionForm>
      </Card>
      {isOwner && (
        <Card title="👤 Admin nhận lương">
          <p className="mb-2 text-xs text-ink/70">
            Tạo hồ sơ nhân viên cho admin (cùng Gmail) để admin có dòng trong <b>Bảng lương</b> của cơ sở đã chọn. Full-time: lương cơ bản = lương cứng / tháng, giờ chấm công
            vẫn được đếm. Sau khi tạo, admin hiện trong danh sách trên (nhãn <b>Admin</b>) – sửa lương ở đó.
          </p>
          {!adminChoices.length ? (
            <p className="text-sm text-ink/60">Mọi admin đều đã có hồ sơ nhân viên.</p>
          ) : (
            <ActionForm action={createAdminStaff} submitLabel="Tạo hồ sơ & đặt lương" successText="Đã tạo – admin có trong bảng lương" className="flex flex-wrap items-end gap-2">
              <Field label="Admin">
                <Select name="email" required className="!w-64">
                  {adminChoices.map((a) => (
                    <option key={a.email} value={a.email}>{a.name} · {a.email}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Họ tên (bảng lương)"><Input name="name" placeholder="Để trống = tên admin" className="!w-48" /></Field>
              <Field label="Cơ sở trả lương">
                <Select name="storeId" defaultValue={sp.store || String(stores[0]?._id ?? "")} required className="!w-44">
                  {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
                </Select>
              </Field>
              <PayTermsFields defaultType="FULLTIME" month={localMonth(new Date())} />
            </ActionForm>
          )}
        </Card>
      )}
    </>
  );
}
