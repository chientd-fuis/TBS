import Link from "next/link";
import { isValidObjectId } from "mongoose";
import { requireOwner } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { CashCount, CashTransfer, ShiftClosing, Store } from "@/lib/models";
import { dayRevenueFromClosings } from "@/lib/revenue";
import { applyDayTransfers, mismatchText } from "@/lib/cashbook";
import { recountDayCash } from "@/app/admin/actions/finance";
import { ActionForm } from "@/components/ActionForm";
import Modal from "@/components/Modal";
import { Field, Input } from "@/components/ui";
import { dayVi } from "@/lib/goods";
import { localMonth, viDateTime } from "@/lib/time";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { MonthPicker } from "@/components/MonthPicker";
import { Card, Select } from "@/components/ui";
import CountCheck from "./CountCheck";
import CountColumns from "./CountColumns";

export const dynamic = "force-dynamic";
const vnd = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("vi-VN"));

type SP = { month?: string; store?: string; st?: string };

/**
 * Sổ quỹ → Đếm tiền: doanh thu từng ngày từng cơ sở; Admin Tổng đi lấy & đếm tiền mặt ngày nào thì tích ngày đó.
 * Tổng tiền mặt các ngày đã tích = "Thực tế đã lấy" ở ô Tiền mặt của sổ quỹ.
 */
export default async function CashCountPage({ searchParams }: { searchParams: Promise<SP> }) {
  // Đếm tiền: chỉ Admin Tổng
  const admin = await requireOwner();
  const owner = admin.kind === "OWNER";
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const storeId = sp.store && isValidObjectId(sp.store) ? sp.store : "";
  const st = sp.st === "no" || sp.st === "yes" ? sp.st : "";
  await connectDB();
  const sq = storeId ? { storeId } : {};
  const dateQ = { $gte: `${month}-01`, $lte: `${month}-31` };
  const [stores, closings, transfers, counts] = await Promise.all([
    Store.find().select("name").sort({ name: 1 }).lean(),
    ShiftClosing.find({ ...sq, workDate: dateQ, "revenue.tm": { $ne: null } })
      .select("storeId workDate shiftName createdAt revenue cashMismatch")
      .lean(),
    CashTransfer.find({ ...sq, date: dateQ, kind: { $in: ["DEPOSIT", "WITHDRAW"] } }).lean(),
    CashCount.find({ ...sq, date: dateQ }).lean(),
  ]);
  const nameOf = new Map(stores.map((s) => [String(s._id), s.name.replace(/^TBS\s*/i, "")]));
  // cảnh báo tiền mặt không khớp (lưu trên ca chốt cuối ngày)
  const misOf = new Map<string, number>();
  for (const c of closings) if (c.cashMismatch?.diff) misOf.set(`${c.storeId}|${c.workDate}`, c.cashMismatch.diff);
  const countOf = new Map(counts.map((c) => [`${c.storeId}|${c.date}`, c]));
  const allRows = applyDayTransfers(dayRevenueFromClosings(closings), transfers)
    .map((r) => ({ ...r, count: countOf.get(`${r.storeId}|${r.date}`), mis: misOf.get(`${r.storeId}|${r.date}`) ?? 0 }))
    .sort((a, b) => b.date.localeCompare(a.date) || (nameOf.get(a.storeId) ?? "").localeCompare(nameOf.get(b.storeId) ?? ""));
  const rows = allRows.filter((r) => (st === "yes" ? r.count : st === "no" ? !r.count : true));
  const sumTm = (xs: typeof allRows) => xs.reduce((s, r) => s + r.tm, 0);
  const done = allRows.filter((r) => r.count);

  return (
    <div className="space-y-4">
      <Link href="/admin/finance/cashbook" className="inline-flex text-sm text-accent underline">
        ← Sổ quỹ
      </Link>
      <Card title="🧮 Đếm tiền">
        <p className="mb-3 text-xs text-ink/60">
          Đi qua cửa hàng lấy tiền mặt về đếm xong thì tích ngày đó. Tổng tiền mặt các ngày đã tích = <b>“Thực tế đã lấy”</b> ở ô Tiền mặt của sổ quỹ.
          Tiền mặt ở đây là số chốt ca cuối ngày (đã trừ chi phí két, đã tính phiếu nộp / rút tài khoản).
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker month={month} base="/admin/finance/cashbook/count" params={{ store: storeId || undefined, st: st || undefined }} />
          <AutoFilterForm className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
            <input type="hidden" name="month" value={month} />
            <Select name="store" defaultValue={storeId} className="min-w-0 flex-1 sm:w-44">
              <option value="">Tất cả cơ sở</option>
              {stores.map((s) => (
                <option key={String(s._id)} value={String(s._id)}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select name="st" defaultValue={st} className="min-w-0 flex-1 sm:w-36">
              <option value="">Mọi ngày</option>
              <option value="no">Chưa đếm</option>
              <option value="yes">Đã đếm</option>
            </Select>
          </AutoFilterForm>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-xl bg-cream p-2 ring-1 ring-[#f1e6c8]">
            <div className="text-ink/60">Tiền mặt tháng</div>
            <b className="text-sm tabular-nums">{vnd(sumTm(allRows))}</b>
          </div>
          <div className="rounded-xl bg-cream p-2 ring-1 ring-[#f1e6c8]">
            <div className="text-ink/60">✓ Đã lấy ({done.length})</div>
            <b className="text-sm tabular-nums text-secondary-dark">{vnd(sumTm(done))}</b>
          </div>
          <div className="rounded-xl bg-cream p-2 ring-1 ring-[#f1e6c8]">
            <div className="text-ink/60">Chưa lấy ({allRows.length - done.length})</div>
            <b className="text-sm tabular-nums text-warn">{vnd(sumTm(allRows) - sumTm(done))}</b>
          </div>
        </div>
        <CountColumns>
          {!rows.length ? (
            <p className="mt-3 text-sm text-ink/50">Không có ngày nào.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="tbs text-sm">
                <thead>
                  <tr>
                    <th>Ngày</th>
                    <th className="text-right">Tiền mặt</th>
                    <th className="text-right">DT máy</th>
                    <th className="text-right">Tài khoản</th>
                    <th className="text-right">Chi tiêu</th>
                    <th className="text-right">Grab</th>
                    <th className="text-right">Shopee</th>
                    <th className="text-center">Đã đếm</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.storeId}|${r.date}`} className={r.count ? "bg-secondary/5" : ""}>
                      <td className="whitespace-nowrap">
                        {dayVi(r.date)}
                        {!storeId && <div className="text-xs text-ink/60">{nameOf.get(r.storeId)}</div>}
                      </td>
                      <td className="text-right tabular-nums">
                        <div className="flex items-center justify-end gap-1">
                          <b>{vnd(r.tm)}</b>
                          {owner && (
                            <Modal label="✎" title={`Sửa tiền mặt đếm thực tế – ${nameOf.get(r.storeId) ?? ""} ${dayVi(r.date)}`} className="rounded-md px-1.5 py-0.5 text-xs text-accent hover:bg-primary-light">
                              <ActionForm action={recountDayCash} submitLabel="Lưu" successText="Đã sửa tiền mặt" className="space-y-2">
                                <input type="hidden" name="storeId" value={r.storeId} />
                                <input type="hidden" name="date" value={r.date} />
                                <p className="text-xs text-ink/60">
                                  Tiền mặt theo chốt ca: <b>{vnd(r.tm)}</b>. Nhập số đếm thực tế → sửa tiền mặt của ca chốt cuối ngày, hiện cảnh báo
                                  “Tiền mặt không khớp: Thiếu / Thừa …” cho mọi admin, và tích luôn “đã đếm”.
                                </p>
                                <Field label="Tiền mặt đếm thực tế">
                                  <Input name="counted" defaultValue={vnd(r.tm)} inputMode="numeric" required className="text-right" />
                                </Field>
                              </ActionForm>
                            </Modal>
                          )}
                        </div>
                        {r.mis ? <div className="text-xs font-bold text-danger">⚠ Không khớp: {mismatchText(r.mis)}</div> : null}
                      </td>
                      <td className="text-right tabular-nums">{vnd(r.dt)}</td>
                      <td className="text-right tabular-nums">{vnd(r.tk)}</td>
                      <td className="text-right tabular-nums">{vnd(r.cp)}</td>
                      <td className="text-right tabular-nums">{vnd(r.grab)}</td>
                      <td className="text-right tabular-nums">{vnd(r.shopee)}</td>
                      <td className="text-center">
                        {owner ? (
                          <CountCheck
                            storeId={r.storeId}
                            date={r.date}
                            counted={!!r.count}
                            title={r.count ? `Đã đếm lúc ${viDateTime(r.count.countedAt)}${r.count.countedBy ? ` · ${r.count.countedBy}` : ""}` : "Tích khi đã lấy & đếm tiền mặt ngày này"}
                          />
                        ) : r.count ? (
                          <span className="font-bold text-secondary-dark" title={`Đã đếm lúc ${viDateTime(r.count.countedAt)}`}>✓</span>
                        ) : (
                          <span className="text-ink/30">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CountColumns>
      </Card>
    </div>
  );
}
