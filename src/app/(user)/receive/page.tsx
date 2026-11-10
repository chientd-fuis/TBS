import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { GoodsReceipt } from "@/lib/models";
import { resolveClosingContext } from "@/lib/closing-context";
import { getGoodsCatalog, GOODS_OFF, goodsEnabled } from "@/lib/goods-server";
import { lineVi, type GoodsLine } from "@/lib/goods";
import { geminiConfigured } from "@/lib/ocr";
import { aiAllowed } from "@/lib/ai";
import { addDays, localTime, viDate } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card } from "@/components/ui";
import GoodsForm from "@/components/GoodsForm";
import { deleteGoodsUser, saveGoodsUser } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TG = { SENT: ["Đã báo nhóm", "green"], FAILED: ["Báo nhóm lỗi", "red"], PENDING: ["Đang báo", "yellow"], DISABLED: ["Chưa cấu hình Telegram", "gray"], SKIPPED: ["Không báo nhóm", "gray"] } as const;

/** Nhận hàng: nhân viên ghi đồ / nguyên liệu cơ sở vừa nhận → báo nhóm Telegram */
export default async function ReceivePage() {
  const user = await requireActiveUser();
  if (!(await goodsEnabled())) return <Alert tone="yellow">{GOODS_OFF}.</Alert>;
  const ctx = await resolveClosingContext(user);
  if (!ctx) return <Alert tone="yellow">Bạn chưa thuộc cơ sở nào.</Alert>;
  const { store, tz, today } = ctx;
  const catalog = await getGoodsCatalog();
  const recent = await GoodsReceipt.find({ storeId: store._id, date: { $gte: addDays(today, -2) } }).sort({ date: -1, createdAt: -1 }).limit(20).lean();
  const ocr = geminiConfigured() && (await aiAllowed("goodsOcr", `user:${user._id}`));
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">📦 Nhận hàng</h1>
        <Link href="/" className="text-sm text-accent underline">← Chấm công</Link>
      </div>
      <Card>
        <GoodsForm mode="user" catalog={catalog} today={today} minDate={addDays(today, -7)} ocrEnabled={ocr} storeName={store.name} save={saveGoodsUser} />
      </Card>
      <Card title="Cơ sở đã nhận (3 ngày gần đây)">
        {!recent.length ? (
          <p className="text-sm text-ink/60">Chưa có</p>
        ) : (
          <ul className="divide-y divide-[#f1e6c8] text-sm">
            {recent.map((r) => {
              const tg = TG[(r.telegram?.status ?? "PENDING") as keyof typeof TG];
              const mine = String(r.byUserId) === String(user._id) && !r.byAdmin && Date.now() - new Date(r.createdAt ?? 0).getTime() < 24 * 3600_000;
              return (
                <li key={String(r._id)} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
                    <span>{viDate(r.date).slice(0, 5)} {r.createdAt ? localTime(new Date(r.createdAt), tz).slice(0, 5) : ""}</span>
                    <span>· {r.byName}</span>
                    <Badge tone={tg[1]}>{tg[0]}</Badge>
                    {mine && (
                      <span className="ml-auto">
                        <ActionForm action={deleteGoodsUser} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm="Xoá lần ghi nhận hàng này?">
                          <input type="hidden" name="id" value={String(r._id)} />
                        </ActionForm>
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5">{((r.items ?? []) as GoodsLine[]).map(lineVi).join(" · ")}</p>
                  {r.note && <p className="text-xs text-ink/60">📝 {r.note}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
