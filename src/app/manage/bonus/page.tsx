import { requireStaff } from "@/lib/staff-guard";
import { BonusPenalty, Store, User } from "@/lib/models";
import { localDate, viDate } from "@/lib/time";
import { vnd } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { staffCreateBonus, staffDeleteBonus, staffUpdateBonus } from "../actions";

export const dynamic = "force-dynamic";

/** Thưởng / phạt – nhân viên được cấp quyền: tạo cho nhân viên ở cơ sở được giao; chỉ sửa / xoá được khoản mình tạo. */
export default async function ManageBonus() {
  const { user, stores } = await requireStaff("bonus");
  const today = localDate(new Date());
  const [staff, storeDocs, mine] = await Promise.all([
    User.find({ storeId: { $in: stores }, status: "ACTIVE", _id: { $ne: user._id } }).select("name storeId").sort({ name: 1 }).lean(),
    Store.find({ _id: { $in: stores } }).select("name").lean(),
    BonusPenalty.find({ createdByUserId: user._id }).sort({ date: -1, createdAt: -1 }).limit(60).lean(),
  ]);
  const storeName = new Map(storeDocs.map((s) => [String(s._id), s.name]));
  const names = new Map((await User.find({ _id: { $in: mine.map((b) => b.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const kindSel = (v = "PENALTY") => (
    <Select name="kind" defaultValue={v} className="!w-28">
      <option value="PENALTY">Phạt</option>
      <option value="BONUS">Thưởng</option>
    </Select>
  );
  return (
    <>
      <PageTitle sub="Bạn chỉ sửa / xoá được khoản do mình tạo. Mọi thao tác được ghi lại cho admin cơ sở.">Thưởng / phạt</PageTitle>
      <Card title="Thêm thưởng / phạt">
        <ActionForm action={staffCreateBonus} submitLabel="Thêm" successText="Đã thêm" className="flex flex-wrap items-end gap-2">
          <Field label="Nhân viên">
            <Select name="userId" required defaultValue="" className="!w-52">
              <option value="">— Chọn —</option>
              {staff.map((s) => (
                <option key={String(s._id)} value={String(s._id)}>
                  {s.name}
                  {stores.length > 1 ? ` · ${storeName.get(String(s.storeId))?.replace(/^TBS\s*/i, "") ?? ""}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Loại">{kindSel()}</Field>
          <Field label="Ngày áp dụng"><Input type="date" name="date" defaultValue={today} required className="!w-40" /></Field>
          <Field label="Số tiền"><Input name="amountVnd" inputMode="numeric" required placeholder="VD 50000" className="!w-32 text-right" /></Field>
          <Field label="Nội dung"><Input name="content" required placeholder="VD Đi muộn 15 phút" className="!w-64" /></Field>
        </ActionForm>
      </Card>
      <Card title={`Khoản bạn đã tạo (${mine.length})`}>
        {!mine.length ? (
          <Empty>Chưa có</Empty>
        ) : (
          <ul className="divide-y divide-[#f1e6c8]">
            {mine.map((b) => (
              <li key={String(b._id)} className="space-y-1 py-2.5 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <b>{names.get(String(b.userId)) ?? "?"}</b>
                  <Badge tone={b.kind === "BONUS" ? "green" : "red"}>{b.kind === "BONUS" ? "Thưởng" : "Phạt"} {vnd(b.amountVnd)}</Badge>
                  <span className="text-xs text-ink/60">{viDate(b.date)} · {storeName.get(String(b.storeId))}</span>
                </p>
                <details>
                  <summary className="cursor-pointer text-xs text-accent">{b.content} – sửa / xoá</summary>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <ActionForm action={staffUpdateBonus} submitLabel="Lưu" variant="outline" successText="Đã lưu" className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="id" value={String(b._id)} />
                      <Field label="Loại">{kindSel(b.kind)}</Field>
                      <Field label="Ngày"><Input type="date" name="date" defaultValue={b.date} required className="!w-40" /></Field>
                      <Field label="Số tiền"><Input name="amountVnd" defaultValue={String(b.amountVnd)} inputMode="numeric" required className="!w-32 text-right" /></Field>
                      <Field label="Nội dung"><Input name="content" defaultValue={b.content} required className="!w-64" /></Field>
                    </ActionForm>
                    <ActionForm action={staffDeleteBonus} submitLabel="Xoá" variant="danger" successText="" confirm="Xoá khoản thưởng / phạt này?">
                      <input type="hidden" name="id" value={String(b._id)} />
                    </ActionForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
