import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { FixedCost, Store } from "@/lib/models";
import { daysInMonth } from "@/lib/finance";
import { localMonth, viMonth } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Field, Input, Select } from "@/components/ui";
import { deleteFixedCost, saveFixedCost } from "../../../actions/finance";

export const dynamic = "force-dynamic";
const vnd = (n: number) => n.toLocaleString("vi-VN");

/** Tiền thuê nhà từng cơ sở – chi phí cố định duy nhất, chia đều theo ngày khi tính lãi lỗ. */
export default async function RentPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requirePerm("finance.rent");
  await connectDB();
  const sp = await searchParams;
  const month = localMonth(new Date());
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const list = await FixedCost.find({ scope: { $ne: "SHARED" } }).sort({ startMonth: -1 }).lean();
  const active = (f: (typeof list)[number]) => f.startMonth <= month && (!f.endMonth || f.endMonth >= month);
  const e = sp.edit ? list.find((f) => String(f._id) === sp.edit) : undefined;
  const totalNow = list.filter(active).reduce((s, f) => s + f.amountPerMonth, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
      <Card title={e ? "Sửa tiền thuê nhà" : "Thêm tiền thuê nhà"} actions={e ? <Link href="/admin/finance/fixed" className="text-sm text-accent underline">Huỷ sửa</Link> : null}>
        <p className="mb-3 text-xs text-ink/60">Mỗi cơ sở 1 khoản / tháng, tự chia đều theo ngày khi tính lãi lỗ. Tăng giá thuê → đặt &quot;Đến tháng&quot; cho khoản cũ rồi thêm khoản mới.</p>
        <ActionForm key={e ? String(e._id) : "new"} action={saveFixedCost} submitLabel={e ? "Lưu thay đổi" : "Thêm"} variant="secondary">
          {e && <input type="hidden" name="id" value={String(e._id)} />}
          <Field label="Cơ sở *">
            <Select name="storeId" required defaultValue={e?.storeId ? String(e.storeId) : ""}>
              <option value="">– Chọn cơ sở –</option>
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Tiền thuê / tháng *"><Input name="amountPerMonth" required defaultValue={e?.amountPerMonth} placeholder="VD: 15tr" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ tháng *"><Input type="month" name="startMonth" required defaultValue={e?.startMonth ?? month} /></Field>
            <Field label="Đến tháng" hint="Trống = đang thuê"><Input type="month" name="endMonth" defaultValue={e?.endMonth ?? ""} /></Field>
          </div>
          <Field label="Ghi chú"><Input name="note" defaultValue={e?.note ?? ""} placeholder="VD: trả ngày 5 hằng tháng" /></Field>
        </ActionForm>
      </Card>

      <Card title="Tiền thuê nhà các cơ sở" actions={<span className="text-sm text-ink/70">T{viMonth(month)}: <b className="text-accent">{vnd(totalNow)} đ</b></span>}>
        {!list.length ? (
          <Empty>Chưa nhập tiền thuê nhà.</Empty>
        ) : (
          <div className="space-y-4">
            {stores.map((s) => {
              const rows = list.filter((f) => String(f.storeId) === String(s._id));
              const now = rows.find(active);
              return (
                <div key={String(s._id)}>
                  <p className="flex items-baseline justify-between text-sm font-bold">
                    <span>{s.name}</span>
                    {now ? (
                      <span className="text-accent">
                        {vnd(now.amountPerMonth)} đ/tháng <span className="text-xs font-normal text-ink/50">≈ {vnd(Math.round(now.amountPerMonth / daysInMonth(month)))} đ/ngày</span>
                      </span>
                    ) : (
                      <Badge tone="orange">Chưa có cho tháng này</Badge>
                    )}
                  </p>
                  <ul className="mt-1 divide-y divide-line">
                    {rows.map((f) => (
                      <li key={String(f._id)} className={`flex items-center gap-3 py-1.5 text-sm ${active(f) ? "" : "opacity-50"}`}>
                        <span className="flex-1">
                          {vnd(f.amountPerMonth)} đ · từ {viMonth(f.startMonth)}{f.endMonth ? ` đến ${viMonth(f.endMonth)}` : " · đang thuê"}
                          {f.note && <span className="block text-xs text-ink/60">{f.note}</span>}
                        </span>
                        <Link href={`/admin/finance/fixed?edit=${f._id}`} className="text-xs text-accent underline">Sửa</Link>
                        <ActionForm action={deleteFixedCost} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={`Xoá khoản thuê ${vnd(f.amountPerMonth)} đ của ${s.name}? (Ngừng thuê thì nên đặt "Đến tháng" để giữ số liệu các tháng trước)`}>
                          <input type="hidden" name="id" value={String(f._id)} />
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
