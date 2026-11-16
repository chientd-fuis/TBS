import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList } from "lucide-react";
import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/guards";
import { isProbation } from "@/lib/probation";
import { GoodsReceipt } from "@/lib/models";
import { resolveClosingContext } from "@/lib/closing-context";
import { getGoodsCatalog, GOODS_OFF, goodsEnabled, STOCK_OFF, stockEnabled } from "@/lib/goods-server";
import { dayVi, type GoodsKind, type GoodsLine } from "@/lib/goods";
import { aiPhotoOn } from "@/lib/ai-photo";
import { GoodsEntry } from "@/components/GoodsEntry";
import { geminiConfigured } from "@/lib/ocr";
import { aiAllowed } from "@/lib/ai";
import { addDays, localTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card } from "@/components/ui";
import GoodsForm from "@/components/GoodsForm";
import { deleteGoodsUser, saveGoodsUser } from "./actions";

const TG = { SENT: ["Đã báo nhóm", "green"], FAILED: ["Báo nhóm lỗi", "red"], PENDING: ["Đang báo", "yellow"], DISABLED: ["Chưa cấu hình Telegram", "gray"], SKIPPED: ["Không báo nhóm", "gray"] } as const;

/** Nhận hàng / tồn kho: nhân viên ghi đồ cơ sở vừa nhận / số còn cuối ngày → báo nhóm Telegram */
export default async function GoodsUserPage({ kind }: { kind: GoodsKind }) {
  const user = await requireActiveUser();
  if (isProbation(user)) redirect("/"); // nhân viên thử việc không nhận hàng / tồn kho
  const stock = kind === "STOCK";
  if (!(await goodsEnabled())) return <Alert tone="yellow">{GOODS_OFF}.</Alert>;
  if (stock && !(await stockEnabled())) return <Alert tone="yellow">{STOCK_OFF}.</Alert>;
  const ctx = await resolveClosingContext(user);
  if (!ctx) return <Alert tone="yellow">Bạn chưa thuộc cơ sở nào.</Alert>;
  const { store, tz, today } = ctx;
  const catalog = await getGoodsCatalog();
  const recent = await GoodsReceipt.find({ storeId: store._id, kind: stock ? "STOCK" : { $ne: "STOCK" }, date: { $gte: addDays(today, -2) } }).sort({ date: -1, createdAt: -1 }).limit(20).lean();
  const ocr = geminiConfigured() && (await aiAllowed("goodsOcr", `user:${user._id}`));
  // Cài đặt → Đọc ảnh bằng AI: bật / tắt riêng nhận / trả / tồn kho
  const ocrByKind = { RECEIVE: await aiPhotoOn("receive"), RETURN: await aiPhotoOn("return"), STOCK: await aiPhotoOn("stock") };
  const stockOn = await stockEnabled();
  // tab Tồn kho: hôm nay cơ sở đã kiểm kê chưa
  const todayStock = stock ? recent.find((r) => r.kind === "STOCK" && r.date === today) : null;
  // tab Tồn kho: tổng số lần nhận / trả của cơ sở trong tháng này
  let monthNote: string | undefined;
  if (stock) {
    const from = `${today.slice(0, 7)}-01`;
    const [nRecv, nRet] = await Promise.all([
      GoodsReceipt.countDocuments({ storeId: store._id, kind: { $in: ["RECEIVE", null] }, date: { $gte: from, $lte: today } }),
      GoodsReceipt.countDocuments({ storeId: store._id, kind: "RETURN", date: { $gte: from, $lte: today } }),
    ]);
    monthNote = `Tháng ${Number(today.slice(5, 7))}: đã nhận ${nRecv} lần · trả ${nRet} lần`;
  }
  const tabs = [
    { k: "RECEIVE", href: "/receive", label: "Nhận", icon: <ArrowDownToLine size={16} aria-hidden /> },
    { k: "RETURN", href: "/receive?tab=return", label: "Trả", icon: <ArrowUpFromLine size={16} aria-hidden /> },
    ...(stockOn ? [{ k: "STOCK", href: "/stock", label: "Tồn kho", icon: <ClipboardList size={16} aria-hidden /> }] : []),
  ];
  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Hàng hoá</h1>
        <Link href="/" className="text-sm text-accent underline">← Chấm công</Link>
      </div>
      {/* Nhận | Trả | Tồn kho – tab đang chọn nền accent (nâu ở theme mặc định) */}
      <nav role="tablist" aria-label="Hàng hoá" className={`grid gap-1 rounded-2xl bg-muted p-1 ${tabs.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {tabs.map((t) => (
          <Link
            key={t.k}
            href={t.href}
            role="tab"
            aria-selected={t.k === kind}
            replace
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm ${t.k === kind ? "bg-accent font-bold text-on-accent shadow-sm" : "font-semibold text-ink/70"}`}
          >
            {t.icon}
            {t.label}
          </Link>
        ))}
      </nav>
      {stock &&
        (todayStock ? (
          <p className="flex items-center gap-2 rounded-xl bg-ok-bg px-3 py-2 text-[13px] text-good ring-1 ring-ok-line">
            ✓ Hôm nay đã kiểm kê{todayStock.createdAt ? ` lúc ${localTime(new Date(todayStock.createdAt), tz).slice(0, 5)}` : ""} · {todayStock.byName}
          </p>
        ) : (
          <p className="flex items-center gap-2 rounded-xl bg-bad-bg px-3 py-2 text-[13px] text-bad-fg ring-1 ring-bad-line">
            <b>Hôm nay chưa kiểm kê</b> – làm cuối ca Tối
          </p>
        ))}
      <Card>
        <GoodsForm key={kind} mode="user" kind={kind} allowReturn={false} catalog={catalog} today={today} ocrEnabled={ocr} ocrByKind={ocrByKind} storeName={store.name} monthNote={monthNote} save={saveGoodsUser} />
      </Card>
      <Card title={stock ? "Cơ sở đã báo tồn (3 ngày gần đây)" : "Cơ sở đã nhận / trả (3 ngày gần đây)"}>
        {!recent.length ? (
          <p className="text-sm text-ink/60">Chưa có</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {recent.map((r) => {
              const tg = TG[(r.telegram?.status ?? "PENDING") as keyof typeof TG];
              const mine = String(r.byUserId) === String(user._id) && !r.byAdmin && Date.now() - new Date(r.createdAt ?? 0).getTime() < 24 * 3600_000;
              return (
                <li key={String(r._id)} className="py-2">
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-ink/60">
                    <span className="font-semibold text-ink/80">{dayVi(r.date)}</span>
                    <span>{r.createdAt ? localTime(new Date(r.createdAt), tz).slice(0, 5) : ""}</span>
                    <span>· {r.byName}</span>
                    {r.kind === "RETURN" ? <Badge tone="orange">↩ Trả{r.reason ? ` · ${r.reason}` : ""}</Badge> : !stock && <Badge tone="green">Nhận</Badge>}
                    <Badge tone={tg[1]}>{tg[0]}</Badge>
                    {mine && (
                      <span className="ml-auto">
                        <ActionForm action={deleteGoodsUser} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={stock ? "Xoá lần báo tồn kho này?" : r.kind === "RETURN" ? "Xoá lần ghi trả hàng này?" : "Xoá lần ghi nhận hàng này?"}>
                          <input type="hidden" name="id" value={String(r._id)} />
                        </ActionForm>
                      </span>
                    )}
                  </div>
                  <GoodsEntry raw={r.raw} sender={r.sender && r.sender !== r.byName ? r.sender : null} items={(r.items ?? []) as GoodsLine[]} note={r.note} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
