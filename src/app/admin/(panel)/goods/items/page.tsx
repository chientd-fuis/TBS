import { requirePerm } from "@/lib/guards";
import { getGoodsItems, stockEnabled } from "@/lib/goods-server";
import { priceAt } from "@/lib/goods";
import { vnd } from "@/lib/format";
import { localDate, viDate } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Card, Empty, Field, Input, PageTitle } from "@/components/ui";
import { addGoodsPrice, removeGoodsPrice, saveGoodsItem, toggleGoodsItem } from "../../../actions/goods";
import GoodsTabs from "../GoodsTabs";

export const dynamic = "force-dynamic";

/** Danh mục nguyên liệu: thêm / sửa / xoá, cách gọi tắt, giá nhập theo ngày áp dụng (tăng / giảm giá). */
export default async function GoodsItemsPage() {
  const admin = await requirePerm("goods.items");
  const today = localDate(new Date());
  const items = await getGoodsItems();
  const active = items.filter((i) => i.active);
  const removed = items.filter((i) => !i.active);
  const noPrice = active.filter((i) => !i.prices.length).length;

  return (
    <>
      <PageTitle sub="Tên, đơn vị tính giá, cách gọi tắt (để đọc tin “nhận 5mn…”) và giá nhập theo ngày – dùng cho Tổng hợp tháng">Nguyên liệu &amp; giá</PageTitle>
      <GoodsTabs active="items" stockOn={await stockEnabled()} admin={admin} />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-3">
          <Card title="Thêm nguyên liệu">
            <ActionForm action={saveGoodsItem} submitLabel="Thêm" successText="Đã thêm">
              <div className="space-y-2">
                <Field label="Tên"><Input name="name" required placeholder="VD Bột năng" /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Đơn vị tính giá"><Input name="unit" placeholder="gói / kg / hộp" /></Field>
                  <Field label="Giá nhập (tuỳ chọn)"><Input name="price" inputMode="numeric" placeholder="20000 hoặc 20k" /></Field>
                </div>
                <Field label="Cách gọi tắt (cách nhau dấu phẩy)"><Input name="aliases" placeholder="bột na, bn" /></Field>
                <Field label="Giá áp dụng từ ngày"><Input type="date" name="from" defaultValue={today} /></Field>
              </div>
            </ActionForm>
          </Card>
          <Card title="Cách tính">
            <ul className="list-disc space-y-1 pl-4 text-xs text-ink/70">
              <li><b>Tăng / giảm giá:</b> mở món → thêm giá mới “từ ngày”. VD từ 15/11 giá 20k → hàng nhận từ 15/11 tính 20k, trước đó vẫn tính giá cũ 19k.</li>
              <li><b>Đơn vị:</b> giá tính theo đơn vị của món. Lần nhận ghi khác đơn vị (VD món tính theo “hộp” mà nhân viên ghi “2 thùng”) sẽ không được cộng tiền – Tổng hợp tháng có báo số dòng lệch.</li>
              <li><b>Xoá</b> chỉ ẩn món khỏi danh sách chọn, lịch sử cũ vẫn giữ; khôi phục được ở cuối trang.</li>
              <li><b>Đổi tên</b> → tên trong các lần nhận / tồn kho cũ đổi theo.</li>
            </ul>
          </Card>
        </div>

        <Card title={`Danh sách (${active.length})`} actions={noPrice ? <span className="text-xs text-warn">{noPrice} món chưa có giá</span> : undefined}>
          {!active.length ? (
            <Empty>Chưa có nguyên liệu.</Empty>
          ) : (
            <ul className="divide-y divide-[#f1e6c8]">
              {active.map((it) => {
                const cur = priceAt(it.prices, today);
                const next = it.prices.filter((p) => p.from > today).sort((a, b) => a.from.localeCompare(b.from))[0];
                return (
                  <li key={it.id} className="py-2">
                    <details>
                      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 text-sm">
                        <b>{it.name}</b>
                        {it.unit && <span className="text-xs text-ink/60">/{it.unit}</span>}
                        {it.aliases.length > 0 && <span className="truncate text-xs text-ink/50">({it.aliases.join(", ")})</span>}
                        <span className="ml-auto tabular-nums">{cur != null ? <b className="text-secondary-dark">{vnd(cur)}</b> : <span className="text-xs text-warn">chưa có giá</span>}</span>
                        {next && <span className="w-full text-right text-xs text-accent">từ {viDate(next.from).slice(0, 5)}: {vnd(next.price)}</span>}
                      </summary>
                      <div className="mt-2 grid gap-3 rounded-xl bg-cream p-3 md:grid-cols-2">
                        <ActionForm action={saveGoodsItem} submitLabel="Lưu" successText="Đã lưu">
                          <input type="hidden" name="id" value={it.id} />
                          <div className="space-y-2">
                            <Field label="Tên"><Input name="name" defaultValue={it.name} required /></Field>
                            <Field label="Đơn vị tính giá"><Input name="unit" defaultValue={it.unit} /></Field>
                            <Field label="Cách gọi tắt"><Input name="aliases" defaultValue={it.aliases.join(", ")} /></Field>
                          </div>
                        </ActionForm>
                        <div>
                          <p className="mb-1 text-xs font-semibold text-ink/70">Giá nhập theo ngày</p>
                          {it.prices.length ? (
                            <ul className="mb-2 space-y-1 text-sm">
                              {it.prices.map((p) => (
                                <li key={p.from} className="flex items-center gap-2">
                                  <span className="w-24 text-xs text-ink/60">từ {viDate(p.from)}</span>
                                  <b className="tabular-nums">{vnd(p.price)}</b>
                                  <span className="ml-auto">
                                    <ActionForm action={removeGoodsPrice} submitLabel="✕" variant="ghost" successText="" className="flex" confirm={`Xoá giá ${vnd(p.price)} từ ${viDate(p.from)}?`}>
                                      <input type="hidden" name="id" value={it.id} />
                                      <input type="hidden" name="from" value={p.from} />
                                    </ActionForm>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mb-2 text-xs text-ink/60">Chưa có giá</p>
                          )}
                          <ActionForm action={addGoodsPrice} submitLabel={it.prices.length ? "Thêm giá mới (tăng / giảm)" : "Thêm giá"} successText="Đã thêm giá" variant="secondary">
                            <input type="hidden" name="id" value={it.id} />
                            <div className="grid grid-cols-2 gap-2">
                              <Input type="date" name="from" defaultValue={today} required />
                              <Input name="price" inputMode="numeric" placeholder="20000 / 20k" required />
                            </div>
                          </ActionForm>
                        </div>
                        <div className="md:col-span-2">
                          <ActionForm action={toggleGoodsItem} submitLabel="Xoá món này" variant="ghost" successText="" confirm={`Xoá “${it.name}” khỏi danh mục? (lịch sử cũ vẫn giữ, khôi phục được)`}>
                            <input type="hidden" name="id" value={it.id} />
                            <input type="hidden" name="on" value="0" />
                          </ActionForm>
                        </div>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
          {removed.length > 0 && (
            <details className="mt-4 border-t border-[#f1e6c8] pt-3">
              <summary className="cursor-pointer text-sm text-ink/60">Đã xoá ({removed.length})</summary>
              <ul className="mt-2 space-y-1">
                {removed.map((it) => (
                  <li key={it.id} className="flex items-center gap-2 text-sm text-ink/60">
                    <span className="flex-1 line-through">{it.name}</span>
                    <ActionForm action={toggleGoodsItem} submitLabel="Khôi phục" variant="ghost" successText="" className="flex">
                      <input type="hidden" name="id" value={it.id} />
                      <input type="hidden" name="on" value="1" />
                    </ActionForm>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>
    </>
  );
}
