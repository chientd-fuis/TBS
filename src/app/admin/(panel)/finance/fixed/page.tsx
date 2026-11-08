import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { FixedCost, Store } from "@/lib/models";
import { ALLOCATIONS, ALLOCATION_LABEL, CATEGORY_LABEL, EXPENSE_CATEGORIES } from "@/lib/finance";
import { localMonth, viMonth } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, Field, Input, Select } from "@/components/ui";
import { deleteFixedCost, saveFixedCost } from "../../../actions/finance";

export const dynamic = "force-dynamic";
const vnd = (n: number) => n.toLocaleString("vi-VN");

export default async function FixedCostsPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  await requireAdmin();
  await connectDB();
  const sp = await searchParams;
  const month = localMonth(new Date());
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const storeName = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
  const list = await FixedCost.find().sort({ endMonth: 1, startMonth: -1, name: 1 }).lean();
  const active = (f: (typeof list)[number]) => f.startMonth <= month && (!f.endMonth || f.endMonth >= month);
  const totalActive = list.filter(active).reduce((s, f) => s + f.amountPerMonth, 0);
  const e = sp.edit ? list.find((f) => String(f._id) === sp.edit) : undefined;
  const share = (sid: string) => e?.customShares?.find((c: { storeId?: unknown }) => String(c.storeId) === sid)?.pct ?? "";

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <Card title={e ? "Sửa chi phí cố định" : "Thêm chi phí cố định"} actions={e ? <Link href="/admin/finance/fixed" className="text-sm text-accent underline">Huỷ sửa</Link> : null}>
        <p className="mb-3 text-xs text-ink/60">Khoản trả hằng tháng (mặt bằng, điện nước ước tính, internet, phần mềm…). Hệ thống chia đều theo ngày để lãi lỗ từng ngày không bị dồn vào ngày trả tiền.</p>
        <ActionForm key={e ? String(e._id) : "new"} action={saveFixedCost} submitLabel={e ? "Lưu thay đổi" : "Thêm"} variant="secondary">
          {e && <input type="hidden" name="id" value={String(e._id)} />}
          <Field label="Tên khoản *"><Input name="name" required defaultValue={e?.name} placeholder="VD: Mặt bằng Văn Phú" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Danh mục *">
              <Select name="category" defaultValue={e?.category ?? "MAT_BANG"}>
                {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </Field>
            <Field label="Số tiền / tháng *"><Input name="amountPerMonth" required inputMode="text" defaultValue={e?.amountPerMonth} placeholder="VD: 15tr" /></Field>
            <Field label="Tính cho *">
              <Select name="scope" defaultValue={e?.scope ?? "STORE"}>
                <option value="STORE">1 cơ sở</option>
                <option value="SHARED">Chung các cơ sở</option>
              </Select>
            </Field>
            <Field label="Cơ sở (nếu 1 cơ sở)">
              <Select name="storeId" defaultValue={e?.storeId ? String(e.storeId) : ""}>
                <option value="">–</option>
                {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Cách chia (nếu chung)">
            <Select name="allocation" defaultValue={e?.allocation ?? "REVENUE"}>
              {ALLOCATIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </Select>
          </Field>
          <details className="text-sm" open={e?.allocation === "CUSTOM"}>
            <summary className="cursor-pointer text-xs text-accent">Tỷ lệ tự đặt (%)</summary>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {stores.map((s) => (
                <Field key={String(s._id)} label={storeName.get(String(s._id)) ?? ""}>
                  <Input name={`pct_${s._id}`} inputMode="decimal" defaultValue={share(String(s._id))} />
                </Field>
              ))}
            </div>
          </details>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Từ tháng *"><Input type="month" name="startMonth" required defaultValue={e?.startMonth ?? month} /></Field>
            <Field label="Đến tháng" hint="Trống = vẫn đang trả"><Input type="month" name="endMonth" defaultValue={e?.endMonth ?? ""} /></Field>
          </div>
          <Field label="Ghi chú"><Input name="note" defaultValue={e?.note ?? ""} /></Field>
        </ActionForm>
      </Card>

      <Card title="Danh sách" actions={<span className="text-sm text-ink/70">Đang áp dụng T{viMonth(month)}: <b className="text-accent">{vnd(totalActive)} đ/tháng</b></span>}>
        {!list.length ? (
          <Empty>Chưa có khoản cố định nào.</Empty>
        ) : (
          <ul className="divide-y divide-[#f1e6c8]">
            {list.map((f) => (
              <li key={String(f._id)} className={`flex flex-wrap items-start gap-3 py-2.5 text-sm ${active(f) ? "" : "opacity-50"}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{f.name} <span className="font-normal text-ink/60">· {CATEGORY_LABEL[f.category] ?? f.category}</span></p>
                  <p className="text-xs text-ink/70">
                    {vnd(f.amountPerMonth)} đ/tháng · từ {viMonth(f.startMonth)}{f.endMonth ? ` đến ${viMonth(f.endMonth)}` : ""}{f.note ? ` · ${f.note}` : ""}
                  </p>
                  <div className="mt-1">
                    {f.scope === "SHARED" ? <Badge tone="blue">Chung · {(ALLOCATION_LABEL[f.allocation ?? "REVENUE"] ?? "").toLowerCase()}</Badge> : <Badge tone="yellow">{storeName.get(String(f.storeId)) ?? "?"}</Badge>}
                    {!active(f) && <Badge tone="gray">Không áp dụng tháng này</Badge>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={`/admin/finance/fixed?edit=${f._id}`} className="text-xs text-accent underline">Sửa</Link>
                  <ActionForm action={deleteFixedCost} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={`Xoá "${f.name}"? (Nếu chỉ ngừng trả, nên đặt "Đến tháng" để giữ số liệu các tháng trước)`}>
                    <input type="hidden" name="id" value={String(f._id)} />
                  </ActionForm>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
