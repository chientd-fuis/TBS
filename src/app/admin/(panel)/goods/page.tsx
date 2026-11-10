import Link from "next/link";
import { isValidObjectId } from "mongoose";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { GoodsReceipt, Store } from "@/lib/models";
import { getGoodsCatalog, GOODS_OFF, goodsEnabled } from "@/lib/goods-server";
import { catalogToText, lineVi, qtyVi, type GoodsLine } from "@/lib/goods";
import { geminiConfigured } from "@/lib/ocr";
import { aiAllowed } from "@/lib/ai";
import { isYmd, localDate, localMonth, localTime, viDate, weekdayVi } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Badge, Card, Empty, Input, PageTitle, Select, Textarea } from "@/components/ui";
import GoodsForm from "@/components/GoodsForm";
import { deleteGoods, saveGoodsAdmin, saveGoodsCatalog } from "../../actions/goods";

export const dynamic = "force-dynamic";

const TG = { SENT: ["TG: đã báo", "green"], FAILED: ["TG: lỗi", "red"], PENDING: ["TG: đang gửi", "yellow"], DISABLED: ["TG: chưa cấu hình", "gray"], SKIPPED: ["TG: không báo", "gray"] } as const;
const SRC = { PHOTO: "Ảnh nhóm chat", TEXT: "Gõ tin", MANUAL: "Chọn tay" } as const;

/** Nhận hàng các cơ sở theo ngày: nhập (gõ / ảnh nhóm chat), tổng hợp tháng, danh mục nguyên liệu. */
export default async function GoodsPage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string; date?: string; edit?: string }> }) {
  const admin = await requirePerm("goods");
  await connectDB();
  const sp = await searchParams;
  const today = localDate(new Date());
  const date = isYmd(sp.date) ? sp.date : "";
  const month = date ? date.slice(0, 7) : /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const stores = (await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean()).map((s) => ({ id: String(s._id), name: s.name }));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const store = sp.store && isValidObjectId(sp.store) ? sp.store : "";
  const q: Record<string, unknown> = date ? { date } : { month };
  if (store) q.storeId = store;
  const list = await GoodsReceipt.find(q).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
  const catalog = await getGoodsCatalog();
  const edit = sp.edit && isValidObjectId(sp.edit) ? await GoodsReceipt.findById(sp.edit).lean() : null;
  const on = await goodsEnabled();
  const ocr = geminiConfigured() && (await aiAllowed("goodsOcr", `admin:${admin.accountId ?? "owner"}`));

  // tổng hợp: món × cơ sở (cộng theo đơn vị)
  const cols = store ? stores.filter((s) => s.id === store) : stores.filter((s) => list.some((r) => String(r.storeId) === s.id));
  const order = new Map(catalog.map((c, i) => [c.name, i]));
  const sum = new Map<string, Map<string, Map<string, number>>>(); // món → cơ sở ("" = tổng) → đơn vị → số
  for (const r of list)
    for (const l of (r.items ?? []) as GoodsLine[]) {
      const byStore = sum.get(l.name) ?? new Map<string, Map<string, number>>();
      for (const k of [String(r.storeId), ""]) {
        const u = byStore.get(k) ?? new Map<string, number>();
        u.set(l.unit ?? "", Math.round(((u.get(l.unit ?? "") ?? 0) + (l.qty ?? 0)) * 1000) / 1000);
        byStore.set(k, u);
      }
      sum.set(l.name, byStore);
    }
  const rows = [...sum.keys()].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const cell = (u?: Map<string, number>) => (u ? [...u].map(([unit, n]) => `${qtyVi(n)}${unit ? ` ${unit}` : ""}`).join(" + ") : "");
  const days = [...new Set(list.map((r) => r.date))];
  const base = `/admin/goods?month=${month}${store ? `&store=${store}` : ""}`;

  return (
    <>
      <PageTitle sub="Đồ / nguyên liệu các cơ sở nhận mỗi ngày – nhân viên ghi ở nút “Nhận hàng”, hoặc admin nhập từ ảnh nhóm chat">Nhận hàng</PageTitle>
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          {!on ? (
            <Alert tone="orange">
              {GOODS_OFF}. Nhân viên không thấy nút Nhận hàng, không nhập mới được; dữ liệu cũ vẫn xem ở đây.{" "}
              {admin.kind === "OWNER" && <Link href="/admin/settings" className="underline">Bật lại ở Cài đặt →</Link>}
            </Alert>
          ) : edit ? (
            <Card title="Sửa lần nhận" actions={<Link href={base} className="text-sm text-accent underline">Huỷ sửa</Link>}>
              <GoodsForm
                key={String(edit._id)}
                mode="admin"
                catalog={catalog}
                today={today}
                ocrEnabled={false}
                stores={stores}
                initial={{ id: String(edit._id), storeId: String(edit.storeId), date: edit.date, lines: (edit.items ?? []) as GoodsLine[], note: edit.note ?? "" }}
                save={saveGoodsAdmin}
              />
            </Card>
          ) : (
            <Card title="Nhập nhận hàng">
              <GoodsForm mode="admin" catalog={catalog} today={today} ocrEnabled={ocr} stores={stores} storeId={store || (stores.length === 1 ? stores[0].id : "")} save={saveGoodsAdmin} />
              <p className="mt-2 text-xs text-ink/60">
                Ảnh nhóm chat: chụp màn hình đoạn nhân viên báo “nhận …” (tối đa 4 ảnh) → AI tách từng tin, ngày, người báo. Tin trùng với lần đã ghi sẽ được đánh dấu ⚠.
              </p>
            </Card>
          )}
          <Card title="Danh mục nguyên liệu">
            <details>
              <summary className="cursor-pointer text-sm text-accent underline">{catalog.length} món – bấm để sửa / thêm cách gọi tắt</summary>
              <ActionForm action={saveGoodsCatalog} submitLabel="Lưu danh mục" successText="Đã lưu danh mục">
                <p className="mb-1 mt-2 text-xs text-ink/60">
                  Mỗi dòng 1 món: <b>Tên | đơn vị | cách gọi tắt, …</b> – VD <code>Bột năng | gói | bột na</code>, <code>Mini | hộp | mn</code>. Viết có dấu hay không đều được, số đứng liền chữ cũng hiểu (“5mn”).
                </p>
                <Textarea name="catalog" rows={16} defaultValue={catalogToText(catalog)} className="font-mono text-xs" />
              </ActionForm>
            </details>
          </Card>
        </div>

        <div className="min-w-0 space-y-3">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <MonthPicker month={month} base="/admin/goods" params={{ store: store || undefined }} />
              <AutoFilterForm className="flex flex-wrap gap-2">
                <input type="hidden" name="month" value={month} />
                <Select name="store" defaultValue={store} className="w-auto">
                  <option value="">Tất cả cơ sở</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Input type="date" name="date" defaultValue={date} max={today} className="!w-auto" />
              </AutoFilterForm>
              {date && <Link href={base} className="text-sm text-accent underline">Cả tháng</Link>}
            </div>
          </Card>

          <Card title={`Tổng nhận ${date ? `ngày ${viDate(date)}` : `tháng ${month.slice(5)}/${month.slice(0, 4)}`}`}>
            {!rows.length ? (
              <Empty>Chưa có lần nhận hàng nào.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#f1e6c8] text-left text-xs text-ink/60">
                      <th className="py-1.5 pr-3">Món</th>
                      {cols.map((c) => <th key={c.id} className="px-2 py-1.5 text-right whitespace-nowrap">{c.name.replace(/^TBS\s*/i, "")}</th>)}
                      {cols.length > 1 && <th className="py-1.5 pl-2 text-right">Tổng</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((name) => (
                      <tr key={name} className="border-b border-[#f1e6c8]/60">
                        <td className="py-1.5 pr-3 font-semibold whitespace-nowrap">{name}</td>
                        {cols.map((c) => <td key={c.id} className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{cell(sum.get(name)?.get(c.id))}</td>)}
                        {cols.length > 1 && <td className="py-1.5 pl-2 text-right font-bold tabular-nums whitespace-nowrap">{cell(sum.get(name)?.get(""))}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`Các lần nhận (${list.length})`}>
            {!list.length ? (
              <Empty>Chưa có.</Empty>
            ) : (
              <div className="space-y-4">
                {days.map((d) => (
                  <div key={d}>
                    <Link href={`/admin/goods?date=${d}${store ? `&store=${store}` : ""}`} className="text-sm font-bold text-accent hover:underline">
                      {weekdayVi(d)} · {viDate(d)}
                    </Link>
                    <ul className="mt-1 divide-y divide-[#f1e6c8]">
                      {list
                        .filter((r) => r.date === d)
                        .map((r) => {
                          const tg = TG[(r.telegram?.status ?? "PENDING") as keyof typeof TG];
                          return (
                            <li key={String(r._id)} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2 text-sm">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs text-ink/60">
                                  <b className="text-ink">{storeName.get(String(r.storeId)) ?? "?"}</b> · {r.byName}
                                  {r.sender && r.sender !== r.byName ? ` (báo: ${r.sender})` : ""} · {r.createdAt ? localTime(new Date(r.createdAt)).slice(0, 5) : ""}
                                </p>
                                <p className="mt-0.5">{((r.items ?? []) as GoodsLine[]).map(lineVi).join(" · ")}</p>
                                {r.note && <p className="text-xs text-ink/70">📝 {r.note}</p>}
                                {r.raw && <p className="truncate text-xs italic text-ink/50" title={r.raw}>“{r.raw}”</p>}
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge tone={r.byAdmin ? "yellow" : "blue"}>{r.byAdmin ? "Admin nhập" : "Nhân viên"}</Badge>
                                  <Badge tone="gray">{SRC[(r.source ?? "TEXT") as keyof typeof SRC]}</Badge>
                                  <Badge tone={tg[1]}>{tg[0]}</Badge>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Link href={`${base}${date ? `&date=${date}` : ""}&edit=${r._id}`} className="text-xs text-accent underline">Sửa</Link>
                                <ActionForm action={deleteGoods} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={`Xoá lần nhận ngày ${viDate(r.date)} của ${storeName.get(String(r.storeId)) ?? "?"}?`}>
                                  <input type="hidden" name="id" value={String(r._id)} />
                                </ActionForm>
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
