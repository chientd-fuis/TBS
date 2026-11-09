import { isValidObjectId } from "mongoose";
import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { DayRevenue, ShiftClosing, Store, User } from "@/lib/models";
import { isYmd, localDate, localTime, viDate } from "@/lib/time";
import { telegramConfigured } from "@/lib/telegram";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { deleteClosing, editClosingRevenue, resendClosing, syncClosingSheet } from "../../actions/closing";
import { closingSum, REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type Revenue } from "@/lib/revenue";
import { sheetsConfigured } from "@/lib/sheets";
import { addDays } from "@/lib/time";
import { ocrConfigured } from "@/lib/ocr";
import AddClosing from "./AddClosing";

export const dynamic = "force-dynamic";

const vnd = (n?: number | null) => (n == null ? "" : n.toLocaleString("vi-VN"));
const SHEET = { SENT: ["Đã ghi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Chưa ghi", "gray"], DISABLED: ["Chưa cấu hình", "gray"] } as const;
const TG = { SENT: ["Đã gửi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Đang gửi", "yellow"], DISABLED: ["Chưa cấu hình", "gray"] } as const;

/** Danh sách chốt ca (ảnh) + trạng thái gửi Telegram */
export default async function ClosingsPage({ searchParams }: { searchParams: Promise<{ store?: string; date?: string; status?: string; nodt?: string; shift?: string }> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find().sort({ name: 1 }).lean();
  const q: Record<string, unknown> = {};
  if (sp.store && isValidObjectId(sp.store)) q.storeId = sp.store; // link sai tham số → bỏ qua lọc (tránh lỗi 500)
  if (isYmd(sp.date)) q.workDate = sp.date;
  if (sp.status) q["telegram.status"] = sp.status;
  if (sp.shift && ["Sáng", "Chiều", "Tối"].includes(sp.shift)) q.shiftName = sp.shift;
  if (sp.nodt) Object.assign(q, { "revenue.dt": null, "revenue.tm": { $ne: null } });
  const noDtCount = await ShiftClosing.countDocuments({ "revenue.dt": null, "revenue.tm": { $ne: null }, workDate: { $gte: addDays(localDate(new Date()), -45) } });
  const list = await ShiftClosing.find(q).sort({ createdAt: -1 }).limit(100).lean();
  const users = new Map((await User.find({ _id: { $in: list.map((c) => c.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const storeMap = new Map(stores.map((s) => [String(s._id), s]));
  // trạng thái ghi Google Sheet theo ngày (sheet ghi 1 dòng / ngày, số luỹ kế)
  const dayDocs = list.length
    ? await DayRevenue.find({ $or: list.map((c) => ({ storeId: c.storeId, date: c.workDate })) }).select("storeId date lastShift sheet").lean()
    : [];
  const dayMap = new Map(dayDocs.map((d) => [`${d.storeId}|${d.date}`, d]));
  const canSheet = sheetsConfigured();
  // ===== nhập bù: ngày chưa chốt ca Tối (45 ngày tới hôm qua, tính từ ngày cơ sở bắt đầu chốt ca trên app) =====
  const today = localDate(new Date());
  const since = addDays(today, -45);
  const recent = await ShiftClosing.find({ workDate: { $gte: since } }).select("storeId workDate shiftName").lean();
  const existing: Record<string, string[]> = {};
  for (const c of recent) (existing[`${c.storeId}|${c.workDate}`] ??= []).push(c.shiftName ?? "");
  const firstDay = new Map(
    (await ShiftClosing.aggregate<{ _id: unknown; d: string }>([{ $group: { _id: "$storeId", d: { $min: "$workDate" } } }])).map((x) => [String(x._id), x.d]),
  );
  const staffAll = await User.find({ status: "ACTIVE" }).select("name storeId").sort({ name: 1 }).lean();
  const addStores = stores
    .filter((s) => s.active !== false)
    .map((s) => {
      const id = String(s._id);
      const start = firstDay.get(id);
      const missing: string[] = [];
      if (start) for (let d = addDays(today, -1); d >= since && d >= start; d = addDays(d, -1)) if (!existing[`${id}|${d}`]?.includes("Tối")) missing.push(d);
      return { id, name: s.name, missing, staff: staffAll.filter((u) => String(u.storeId) === id).map((u) => ({ id: String(u._id), name: u.name })) };
    });
  return (
    <>
      <PageTitle sub="Mới nhất ở trên. Số chốt ca là LUỸ KẾ (ca Chiều gồm ca Sáng, ca Tối = cả ngày). Doanh thu theo ngày xem ở Tài chính → Doanh thu theo ngày.">Lịch sử chốt ca</PageTitle>
      {admin.kind === "OWNER" && (
        <Link href="/admin/closings/anomaly" className="inline-flex w-fit items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-accent ring-1 ring-[#f1e6c8] hover:bg-primary-light">
          ⚠ Bất thường chốt ca &amp; két (AI) →
        </Link>
      )}
      {noDtCount > 0 && !sp.nodt && (
        <Alert tone="orange">
          Có <b>{noDtCount}</b> ca chưa có <b>Doanh thu máy</b> (45 ngày gần đây) – cần nhập để tính âm/dương & lãi lỗ.{" "}
          <a href="/admin/closings?nodt=1" className="underline">Xem các ca này</a>
        </Alert>
      )}
      {!sheetsConfigured() && <Alert tone="orange">Chưa cấu hình <b>service account Google</b> (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY) – doanh thu chỉ lưu trong app, chưa ghi Google Sheet.</Alert>}
      {!telegramConfigured() && <Alert tone="orange">Chưa cấu hình <b>TELEGRAM_BOT_TOKEN</b> – ảnh chốt ca chỉ được lưu, chưa gửi Telegram. Xem hướng dẫn trong README.</Alert>}
      <AddClosing stores={addStores} existing={existing} today={today} ocrEnabled={ocrConfigured()} />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2 text-sm">
          {[{ id: "", name: "Tất cả" }, ...stores.map((s) => ({ id: String(s._id), name: s.name.replace(/^TBS\s*/i, "") }))].map((s) => {
            const qs = new URLSearchParams(Object.entries({ ...sp, store: s.id }).filter(([, v]) => v) as [string, string][]).toString();
            return (
              <Link key={s.id || "all"} href={`/admin/closings${qs ? `?${qs}` : ""}`} className={`rounded-lg px-3 py-1.5 ${(sp.store ?? "") === s.id ? "bg-secondary font-bold text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {s.name}
              </Link>
            );
          })}
        </div>
        <AutoFilterForm className="flex flex-wrap items-end gap-2">
          {sp.store && <input type="hidden" name="store" value={sp.store} />}
          <Field label="Ca">
            <Select name="shift" defaultValue={sp.shift || ""} className="!w-32">
              <option value="">Tất cả</option>
              <option value="Sáng">Sáng</option>
              <option value="Chiều">Chiều</option>
              <option value="Tối">Tối</option>
            </Select>
          </Field>
          <Field label="Ngày"><Input type="date" name="date" defaultValue={sp.date || ""} className="!w-44" /></Field>
          <Field label="Telegram">
            <Select name="status" defaultValue={sp.status || ""} className="!w-40">
              <option value="">Tất cả</option>
              <option value="SENT">Đã gửi</option>
              <option value="FAILED">Lỗi</option>
              <option value="DISABLED">Chưa cấu hình</option>
            </Select>
          </Field>
        </AutoFilterForm>
      </Card>

      <Card>
        {list.length === 0 ? (
          <Empty>Chưa có lượt chốt ca</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Cơ sở</th><th>Ca</th><th>Ảnh</th><th>Doanh thu</th><th>Ghi chú</th><th>Telegram</th><th>Google Sheet</th><th></th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const store = storeMap.get(String(c.storeId));
                  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
                  const created = c.createdAt ? new Date(c.createdAt) : new Date();
                  const st = TG[(c.telegram?.status ?? "PENDING") as keyof typeof TG];
                  return (
                    <tr key={String(c._id)}>
                      <td className="whitespace-nowrap">{viDate(c.workDate)}<div className="text-xs">{localTime(created, tz)}</div></td>
                      <td className="font-semibold">{c.employeeName || users.get(String(c.userId))}{c.employeePhone && <div className="text-xs font-normal text-ink/60">{c.employeePhone}</div>}{c.addedByAdmin && <div><Badge tone="blue">Nhập bù · {c.addedByAdmin}</Badge></div>}</td>
                      <td className="text-xs">{store?.name}{c.distanceM != null && <div className={c.distanceM > (store?.radiusM ?? 100) ? "text-danger" : "text-ink/60"}>cách quán {c.distanceM}m</div>}</td>
                      <td className="text-xs">
                        {c.shiftLabel || "Ngoài ca"} <span className="text-ink/50">(luỹ kế)</span>
                        {c.checkInAt && <div className="text-ink/60">Vào {localTime(new Date(c.checkInAt), tz).slice(0, 5)}{c.checkOutAt ? ` · Ra ${localTime(new Date(c.checkOutAt), tz).slice(0, 5)}` : ""}</div>}
                        {c.coworkers?.length ? <div className="text-ink/60">Cùng ca: {c.coworkers.join(", ")}</div> : null}
                      </td>
                      <td>
                        <div className="flex gap-1">
                          {c.photos.map((_: unknown, i: number) => (
                            <a key={i} href={`/api/photo?closing=${c._id}&i=${i}`} target="_blank">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/api/photo?closing=${c._id}&i=${i}`} alt={`Ảnh ${i + 1}`} className="h-14 w-14 rounded-lg bg-cream object-cover ring-1 ring-[#f1e6c8]" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {c.revenue?.tm != null ? (
                          <>
                            {c.revenue.dt != null ? (
                              <div className="font-bold">DT máy {vnd(c.revenue.dt)}</div>
                            ) : (
                              <div className="font-bold text-warn">Chưa có DT máy – bấm &quot;Sửa số liệu&quot; để nhập</div>
                            )}
                            <div className="text-ink/70">TM {vnd(c.revenue.tm)} · TK {vnd(c.revenue.tk)}</div>
                            <div className="text-ink/70">Thu chi {vnd(c.revenue.cp)}{c.revenueInput?.cp && /[^\d.,\s]/.test(c.revenueInput.cp) ? ` (${c.revenueInput.cp})` : ""}</div>
                            <div className="text-ink/70">Grab {vnd(c.revenue.grab ?? 0)} · Shopee {vnd(c.revenue.shopee)}</div>
                            {c.staffTotal != null &&
                              (() => {
                                const real = closingSum(c.revenue as Partial<Revenue>);
                                return c.staffTotal === real ? (
                                  <div className="text-secondary-dark">Tổng NV ghi {vnd(c.staffTotal)} ✓</div>
                                ) : (
                                  <div className="font-bold text-danger">NV cộng sai: ghi {vnd(c.staffTotal)}, đúng {vnd(real)}</div>
                                );
                              })()}
                            {c.revenue.dt != null &&
                              (() => {
                                const d = revenueDiff(c.revenue as Partial<Revenue>);
                                return <div className={d ? "font-bold text-danger" : "text-secondary-dark"}>Âm/Dương {d > 0 ? "+" : ""}{vnd(d)}</div>;
                              })()}
                            {c.revenueEditedBy && <div className="text-warn">Admin sửa: {c.revenueEditedBy}</div>}
                            {!!c.editCount && <div className="text-ink/60">NV chốt lại {c.editCount} lần</div>}
                          </>
                        ) : (
                          <span className="text-ink/50">—</span>
                        )}
                        <details className="mt-1">
                          <summary className="cursor-pointer text-accent underline">Sửa số liệu</summary>
                          <ActionForm action={editClosingRevenue} submitLabel="Lưu" successText="Đã lưu" className="mt-1 space-y-1">
                            <input type="hidden" name="id" value={String(c._id)} />
                            {REVENUE_KEYS.map((k) => (
                              <label key={k} className="flex items-center justify-between gap-2">
                                <span>{REVENUE_LABEL[k]}</span>
                                <Input name={k} defaultValue={c.revenueInput?.[k] || (c.revenue?.[k] != null ? vnd(c.revenue[k]) : "")} placeholder={k === "dt" ? "Nhập DT máy" : undefined} className="!w-40 !py-1 text-right" title="Gõ được phép cộng, VD 30k + 20k" />
                              </label>
                            ))}
                          </ActionForm>
                        </details>
                      </td>
                      <td className="max-w-56 text-xs">{c.note}</td>
                      <td className="text-xs">
                        <Badge tone={st[1]}>{st[0]}</Badge>
                        {c.telegram?.error && <div className="mt-1 max-w-48 text-danger">{c.telegram.error}</div>}
                        {c.webhook?.status && <div className="mt-1 text-ink/60">Webhook: {c.webhook.status}</div>}
                      </td>
                      <td className="text-xs">
                        {(() => {
                          const day = dayMap.get(`${c.storeId}|${c.workDate}`);
                          const ss = day?.sheet?.status as keyof typeof SHEET | undefined;
                          const hasRev = c.revenue?.tm != null;
                          const laterShift = day?.lastShift && c.shiftName && day.lastShift !== c.shiftName ? day.lastShift : "";
                          return (
                            <div className="flex min-w-36 flex-col gap-1">
                              {ss && SHEET[ss] && <span><Badge tone={SHEET[ss][1]}>{SHEET[ss][0]}</Badge></span>}
                              {day?.sheet?.syncedAt && ss === "SENT" && <span className="text-ink/60">lúc {localTime(new Date(day.sheet.syncedAt), store?.timezone || "Asia/Ho_Chi_Minh").slice(0, 5)} {viDate(localDate(new Date(day.sheet.syncedAt))).slice(0, 5)}</span>}
                              {day?.sheet?.error && ss !== "SENT" && <span className="max-w-48 text-danger">{day.sheet.error}</span>}
                              {!store?.revenueSheetId ? (
                                <span className="text-ink/50">Cơ sở chưa gắn sheet</span>
                              ) : !canSheet ? null : !hasRev ? (
                                <span className="text-ink/50">Chưa có số liệu</span>
                              ) : (
                                <>
                                  <ActionForm
                                    action={syncClosingSheet}
                                    submitLabel={ss === "SENT" ? "Ghi lại sheet" : "Ghi sheet"}
                                    variant="outline"
                                    successText="Đã ghi Google Sheet"
                                    confirm={`Ghi doanh thu ngày ${viDate(c.workDate)} (${store?.name}) lên Google Sheet?${laterShift ? `\nNgày này đã có chốt Ca ${laterShift} sau ca này → sẽ ghi số luỹ kế của Ca ${laterShift}.` : ""}${ss === "SENT" ? "\nDòng của ngày này trên sheet sẽ bị ghi đè." : ""}`}
                                  >
                                    <input type="hidden" name="id" value={String(c._id)} />
                                  </ActionForm>
                                  {laterShift && <span className="text-ink/60">Sẽ ghi số luỹ kế Ca {laterShift}</span>}
                                </>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td>
                        <div className="flex flex-col gap-1">
                          {c.telegram?.status !== "SENT" && (
                            <ActionForm action={resendClosing} submitLabel="Gửi lại" variant="outline" successText="Đã gửi">
                              <input type="hidden" name="id" value={String(c._id)} />
                            </ActionForm>
                          )}
                          <ActionForm
                            action={deleteClosing}
                            submitLabel="Xoá"
                            variant="danger"
                            successText="Đã xoá"
                            confirm={`Xoá hẳn lượt chốt ca ${c.shiftName ? `Ca ${c.shiftName} ` : ""}ngày ${viDate(c.workDate)} của ${c.employeeName ?? ""}? Doanh thu ngày sẽ được tính lại (đã ghi Google Sheet thì ghi lại số mới). Không khôi phục được.`}
                          >
                            <input type="hidden" name="id" value={String(c._id)} />
                          </ActionForm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink/60">Hiển thị 100 lượt gần nhất · hôm nay {viDate(localDate(new Date()))}</p>
      </Card>
    </>
  );
}
