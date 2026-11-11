import { requireAdmin } from "@/lib/guards";
import { BonusPenalty, Store, User } from "@/lib/models";
import { localDate, localMonth, viDate } from "@/lib/time";
import { vnd } from "@/lib/format";
import { isMonthLocked } from "@/lib/attendance";
import { ActionForm } from "@/components/ActionForm";
import { MonthPicker } from "@/components/MonthPicker";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { createBonusPenalty, deleteBonusPenalty, updateBonusPenalty } from "../../actions/ops";
import KindTabs from "./KindTabs";
import StaffMultiPick from "./StaffMultiPick";
import Modal from "@/components/Modal";
import { AutoFilterForm } from "@/components/AutoFilterForm";

export const dynamic = "force-dynamic";

/** Thưởng / phạt: admin tự nhập số tiền & nội dung, không có mức cố định (spec 3.6) */
export default async function BonusPenaltyPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; month?: string; user?: string; date?: string; att?: string; content?: string; kind?: string; fuser?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find().sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : sp.date?.slice(0, 7) || localMonth(new Date(), tz);
  const staff = await User.find({ storeId: store?._id, status: { $in: ["ACTIVE", "INACTIVE"] } }).sort({ name: 1 }).lean();
  const q: Record<string, unknown> = { storeId: store?._id, month };
  if (sp.kind) q.kind = sp.kind;
  if (sp.fuser) q.userId = sp.fuser;
  const list = await BonusPenalty.find(q).sort({ date: -1, createdAt: -1 }).lean();
  const name = new Map(staff.map((u) => [String(u._id), u.name]));
  const locked = store ? await isMonthLocked(store._id, month) : false;
  // gợi ý nội dung từ các khoản đã nhập (autocomplete)
  const suggestions = await BonusPenalty.distinct("content", { storeId: store?._id });
  const totalB = list.filter((b) => b.kind === "BONUS").reduce((s, b) => s + b.amountVnd, 0);
  const totalP = list.filter((b) => b.kind === "PENALTY").reduce((s, b) => s + b.amountVnd, 0);

  return (
    <>
      <PageTitle sub="Admin tự nhập số tiền và nội dung cho từng khoản">Thưởng / Phạt</PageTitle>
      <Card>
        <AutoFilterForm key={`${store?._id}|${sp.fuser}|${sp.kind}|${month}`} className="flex flex-wrap items-end gap-2" resetOnChange={{ store: ["fuser"] }}>
          <Field label="Cơ sở">
            <Select name="store" defaultValue={String(store?._id)} className="w-44">
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Nhân viên">
            <Select name="fuser" defaultValue={sp.fuser || ""} className="w-44">
              <option value="">Tất cả</option>
              {staff.map((u) => <option key={String(u._id)} value={String(u._id)}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Loại">
            <Select name="kind" defaultValue={sp.kind || ""} className="w-32">
              <option value="">Tất cả</option>
              <option value="PENALTY">Phạt</option>
              <option value="BONUS">Thưởng</option>
            </Select>
          </Field>
          <input type="hidden" name="month" value={month} />
          <div className="ml-auto"><MonthPicker month={month} base="/admin/bonus-penalty" params={{ store: String(store?._id), kind: sp.kind, fuser: sp.fuser }} /></div>
        </AutoFilterForm>
      </Card>

      <div id="form" className="grid gap-4 lg:grid-cols-3">
        <Card title="Thêm thưởng / phạt (1 hoặc nhiều người)">
          {locked ? (
            <Alert tone="yellow">🔒 Đã trả lương tháng {month} – mở khoá ở Bảng lương để thêm.</Alert>
          ) : (
            <ActionForm action={createBonusPenalty} submitLabel="Thêm" successText="Đã thêm">
              <input type="hidden" name="attendanceId" value={sp.att || ""} />
              <KindTabs defaultValue="PENALTY" />
              <StaffMultiPick
                key={`${store?._id}|${sp.user ?? ""}`}
                staff={staff.map((u) => ({ id: String(u._id), name: u.name || "?", inactive: u.status !== "ACTIVE" }))}
                defaultIds={sp.user ? [sp.user] : []}
              />
              <Field label="Ngày áp dụng"><Input type="date" name="date" defaultValue={sp.date || localDate(new Date(), tz)} required /></Field>
              <Field label="Số tiền (VND) – mỗi người"><Input name="amountVnd" inputMode="numeric" placeholder="VD: 50000" required autoFocus={!!sp.att} /></Field>
              <Field label="Nội dung">
                <Input name="content" list="bp-suggest" defaultValue={sp.content || ""} required />
              </Field>
              <datalist id="bp-suggest">{suggestions.slice(0, 50).map((s) => <option key={s} value={s} />)}</datalist>
              {sp.att && <p className="text-xs text-ink/70">Khoản này sẽ liên kết với bản ghi chấm công tương ứng.</p>}
            </ActionForm>
          )}
        </Card>
        <Card title={`Tháng ${month.slice(5)}/${month.slice(0, 4)}`} className="lg:col-span-2" actions={<div className="flex gap-2"><Badge tone="green">Thưởng {vnd(totalB)}</Badge><Badge tone="red">Phạt {vnd(totalP)}</Badge></div>}>
          {list.length === 0 ? (
            <Empty>Chưa có khoản nào</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbs">
                <thead><tr><th>Ngày</th><th>Nhân viên</th><th>Loại</th><th className="text-right">Số tiền</th><th>Nội dung</th><th>Người nhập</th><th></th></tr></thead>
                <tbody>
                  {list.map((b) => (
                    <tr key={String(b._id)}>
                      <td>{viDate(b.date)}</td>
                      <td>{name.get(String(b.userId))}</td>
                      <td><Badge tone={b.kind === "BONUS" ? "green" : "red"}>{b.kind === "BONUS" ? "Thưởng" : "Phạt"}</Badge></td>
                      <td className={`text-right font-semibold ${b.kind === "BONUS" ? "text-bonus" : "text-danger"}`}>{vnd(b.amountVnd)}</td>
                      <td>{b.content}{b.attendanceId && <span className="text-xs text-ink/50"> (gắn chấm công)</span>}</td>
                      <td className="text-xs">{b.createdBy}</td>
                      <td>
                        {!locked && (
                          <div className="flex items-start gap-1">
                            <Modal label="Sửa" title={`Sửa ${b.kind === "BONUS" ? "thưởng" : "phạt"} – ${name.get(String(b.userId)) ?? ""}`}>
                              <ActionForm action={updateBonusPenalty} submitLabel="Lưu">
                                <input type="hidden" name="id" value={String(b._id)} />
                                <KindTabs defaultValue={b.kind as "BONUS" | "PENALTY"} size="sm" />
                                <Field label="Ngày áp dụng"><Input type="date" name="date" defaultValue={b.date} /></Field>
                                <Field label="Số tiền (VND)"><Input name="amountVnd" defaultValue={b.amountVnd} inputMode="numeric" /></Field>
                                <Field label="Nội dung"><Input name="content" defaultValue={b.content} /></Field>
                              </ActionForm>
                            </Modal>
                            <ActionForm action={deleteBonusPenalty} submitLabel="Xoá" variant="ghost" successText="" confirm="Xoá khoản này?">
                              <input type="hidden" name="id" value={String(b._id)} />
                            </ActionForm>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
