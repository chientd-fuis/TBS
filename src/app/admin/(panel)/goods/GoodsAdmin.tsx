import Link from "next/link";
import { isValidObjectId } from "mongoose";
import { requirePerm } from "@/lib/guards";
import { can } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { GoodsReceipt, Store } from "@/lib/models";
import { getGoodsCatalog, GOODS_OFF, goodsEnabled, STOCK_OFF, stockEnabled } from "@/lib/goods-server";
import { dayVi, qtyVi, type GoodsKind, type GoodsLine } from "@/lib/goods";
import { GoodsEntry } from "@/components/GoodsEntry";
import { geminiConfigured } from "@/lib/ocr";
import { aiAllowed } from "@/lib/ai";
import { isYmd, localDate, localMonth, localTime, viDate } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { DatePickButton } from "@/components/DatePickButton";
import { Alert, Badge, Card, Empty, PageTitle, Select } from "@/components/ui";
import GoodsTabs from "./GoodsTabs";
import GoodsForm from "@/components/GoodsForm";
import { deleteGoods, saveGoodsAdmin } from "../../actions/goods";

export type GoodsSearch = { month?: string; store?: string; date?: string; edit?: string };

const TG = { SENT: ["TG: đã báo", "green"], FAILED: ["TG: lỗi", "red"], PENDING: ["TG: đang gửi", "yellow"], DISABLED: ["TG: chưa cấu hình", "gray"], SKIPPED: ["TG: không báo", "gray"] } as const;
const SRC = { PHOTO: "Ảnh (nhóm chat / phiếu)", TEXT: "Gõ tin", MANUAL: "Chọn tay" } as const;

/** Nhận hàng / tồn kho các cơ sở theo ngày: nhập (gõ / ảnh nhóm chat), tổng hợp, danh sách. */
export default async function GoodsAdmin({ kind, sp }: { kind: GoodsKind; sp: GoodsSearch }) {
  const admin = await requirePerm("goods");
  await connectDB();
  const stock = kind === "STOCK";
  const path = stock ? "/admin/goods/stock" : "/admin/goods";
  const today = localDate(new Date());
  const date = isYmd(sp.date) ? sp.date : "";
  const month = date ? date.slice(0, 7) : /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const stores = (await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean()).map((s) => ({ id: String(s._id), name: s.name }));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const store = sp.store && isValidObjectId(sp.store) ? sp.store : "";
  const q: Record<string, unknown> = date ? { date } : { month };
  if (store) q.storeId = store;
  q.kind = stock ? "STOCK" : { $ne: "STOCK" };
  const list = await GoodsReceipt.find(q).sort({ date: -1, createdAt: -1 }).limit(1000).lean();
  const catalog = await getGoodsCatalog();
  const edit = sp.edit && isValidObjectId(sp.edit) ? await GoodsReceipt.findOne({ _id: sp.edit, kind: q.kind }).lean() : null;
  const goodsOn = await goodsEnabled();
  const on = stock ? await stockEnabled() : goodsOn;
  const ocr = geminiConfigured() && (await aiAllowed("goodsOcr", `admin:${admin.accountId ?? "owner"}`));

  // tổng hợp: món × cơ sở (cộng theo đơn vị)
  const cols = store ? stores.filter((s) => s.id === store) : stores.filter((s) => list.some((r) => String(r.storeId) === s.id));
  const order = new Map(catalog.map((c, i) => [c.name, i]));
  const sum = new Map<string, Map<string, Map<string, number>>>(); // món → cơ sở ("" = tổng) → đơn vị → số
  const seen = new Set<string>(); // tồn kho: chỉ lấy lần kiểm MỚI NHẤT của mỗi món × cơ sở (list đã sắp mới → cũ)
  for (const r of list)
    for (const l of (r.items ?? []) as GoodsLine[]) {
      if (stock) {
        const k = `${l.name}|${r.storeId}`;
        if (seen.has(k)) continue;
        seen.add(k);
      }
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
  const base = `${path}?month=${month}${store ? `&store=${store}` : ""}`;
  const what = stock ? "tồn kho" : "nhận";

  return (
    <>
      <PageTitle sub={stock ? "Số nguyên liệu còn ở các cơ sở (kiểm cuối ngày) – nhân viên báo ở nút “Tồn kho”, hoặc admin nhập từ ảnh nhóm chat" : "Đồ / nguyên liệu các cơ sở nhận mỗi ngày – nhân viên ghi ở nút “Nhận hàng”, hoặc admin nhập từ ảnh nhóm chat"}>
        {stock ? "Tồn kho" : "Nhận hàng"}
      </PageTitle>
      <GoodsTabs active={stock ? "stock" : "receive"} stockOn={await stockEnabled()} admin={admin} />
      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-3">
          {!on ? (
            <Alert tone="orange">
              {stock && goodsOn ? STOCK_OFF : GOODS_OFF} (mặc định {stock ? "tắt" : "bật"}). Nhân viên không thấy nút {stock ? "Tồn kho" : "Nhận hàng"}, không nhập mới được; dữ liệu cũ vẫn xem ở đây.{" "}
              {admin.kind === "OWNER" && <Link href="/admin/settings" className="underline">Bật ở Cài đặt →</Link>}
            </Alert>
          ) : (
            <Card title={stock ? "Nhập tồn kho" : "Nhập nhận hàng"}>
              <GoodsForm mode="admin" kind={kind} catalog={catalog} today={today} ocrEnabled={ocr} stores={stores} storeId={store || (stores.length === 1 ? stores[0].id : "")} save={saveGoodsAdmin} />
              <p className="mt-2 text-xs text-ink/60">
                Ảnh: chụp màn hình đoạn nhân viên báo “{stock ? "tồn" : "nhận"} …” trong nhóm chat, hoặc chụp <b>phiếu kiểm kê nguyên liệu</b> (AI lấy cột {stock ? "Tồn" : "Nhập"}) – tối đa 4 ảnh → AI tách từng tin / phiếu, ngày, người báo. Tin trùng với lần đã ghi sẽ được đánh dấu ⚠.
              </p>
            </Card>
          )}
          {can(admin, "goods.items") && (
            <Card title="Danh mục nguyên liệu">
              <p className="text-sm text-ink/70">
                {catalog.length} món. Thêm / sửa / xoá, cách gọi tắt và giá nhập ở tab{" "}
                <Link href="/admin/goods/items" className="text-accent underline">Nguyên liệu &amp; giá</Link>.
              </p>
            </Card>
          )}
        </div>

        <div className="min-w-0 space-y-3">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <MonthPicker month={month} base={path} params={{ store: store || undefined }} />
              {/* mobile: hàng 2 = ô cơ sở (giãn hết chiều ngang) + nút lịch; PC: cùng 1 hàng */}
              <AutoFilterForm className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                <input type="hidden" name="month" value={month} />
                <Select name="store" defaultValue={store} className="flex-1 sm:w-56 sm:flex-none">
                  <option value="">Tất cả cơ sở</option>
                  {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <DatePickButton name="date" value={date} max={today} />
                {date && <Link href={base} className="shrink-0 text-sm whitespace-nowrap text-accent underline">Cả tháng</Link>}
              </AutoFilterForm>
            </div>
          </Card>

          <Card title={`${stock ? "Tồn mới nhất" : "Tổng nhận"} ${date ? `ngày ${dayVi(date)}` : `tháng ${month.slice(5)}/${month.slice(0, 4)}`}`}>
            {!rows.length ? (
              <Empty>Chưa có lần {what} nào.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-ink/60">
                      <th className="py-1.5 pr-3">Món</th>
                      {cols.map((c) => <th key={c.id} className="px-2 py-1.5 text-right whitespace-nowrap">{c.name.replace(/^TBS\s*/i, "")}</th>)}
                      {cols.length > 1 && <th className="py-1.5 pl-2 text-right">Tổng</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((name) => (
                      <tr key={name} className="border-b border-line/60">
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

          <Card title={`${stock ? "Các lần báo tồn" : `Các lần ${what}`} (${list.length})`}>
            {!list.length ? (
              <Empty>Chưa có.</Empty>
            ) : (
              <div className="space-y-4">
                {days.map((d) => (
                  <div key={d}>
                    <Link href={`${path}?date=${d}${store ? `&store=${store}` : ""}`} className="text-sm font-bold text-accent hover:underline">
                      {dayVi(d)}
                    </Link>
                    <ul className="mt-1 divide-y divide-line">
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
                                <GoodsEntry raw={r.raw} sender={r.sender && r.sender !== r.byName ? r.sender : null} items={(r.items ?? []) as GoodsLine[]} note={r.note} />
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <Badge tone={r.byAdmin ? "yellow" : "blue"}>{r.byAdmin ? "Admin nhập" : "Nhân viên"}</Badge>
                                  <Badge tone="gray">{SRC[(r.source ?? "TEXT") as keyof typeof SRC]}</Badge>
                                  <Badge tone={tg[1]}>{tg[0]}</Badge>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Link href={`${base}${date ? `&date=${date}` : ""}&edit=${r._id}`} scroll={false} className="text-xs text-accent underline">Sửa</Link>
                                <ActionForm action={deleteGoods} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={`Xoá lần ${what} ngày ${viDate(r.date)} của ${storeName.get(String(r.storeId)) ?? "?"}?`}>
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
      {on && edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4">
          <Link href={`${base}${date ? `&date=${date}` : ""}`} scroll={false} aria-label="Đóng" className="absolute inset-0" />
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-card p-4 shadow-xl sm:rounded-3xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-bold text-accent">
                {stock ? "Sửa lần kiểm kho" : "Sửa lần nhận"} · {dayVi(edit.date)}
              </p>
              <Link href={`${base}${date ? `&date=${date}` : ""}`} scroll={false} className="text-sm text-accent underline">Đóng</Link>
            </div>
            <GoodsForm
              key={String(edit._id)}
              mode="admin"
              kind={kind}
              catalog={catalog}
              today={today}
              ocrEnabled={false}
              stores={stores}
              initial={{
                id: String(edit._id),
                storeId: String(edit.storeId),
                date: edit.date,
                lines: (edit.items ?? []) as GoodsLine[],
                note: edit.note ?? "",
                raw: edit.raw ?? "",
                sender: edit.sender ?? "",
                source: edit.source ?? "TEXT",
              }}
              save={saveGoodsAdmin}
              doneHref={`${base}${date ? `&date=${date}` : ""}`}
            />
          </div>
        </div>
      )}
    </>
  );
}
