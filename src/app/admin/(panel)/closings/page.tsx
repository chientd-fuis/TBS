import { requireAdmin } from "@/lib/guards";
import { DayRevenue, ShiftClosing, Store, User } from "@/lib/models";
import { isYmd, localDate, localTime, viDate } from "@/lib/time";
import { telegramConfigured } from "@/lib/telegram";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { editClosingRevenue, resendClosing, syncDayRevenue } from "../../actions/closing";
import { REVENUE_KEYS, REVENUE_LABEL, revenueDiff, type Revenue } from "@/lib/revenue";
import { sheetsConfigured } from "@/lib/sheets";
import { addDays } from "@/lib/time";

export const dynamic = "force-dynamic";

const SHEET = { SENT: ["Đã ghi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Chờ ca cuối", "yellow"], DISABLED: ["Chưa cấu hình", "gray"] } as const;
const vnd = (n?: number | null) => (n == null ? "" : n.toLocaleString("vi-VN"));
const TG = { SENT: ["Đã gửi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Đang gửi", "yellow"], DISABLED: ["Chưa cấu hình", "gray"] } as const;

/** Danh sách chốt ca (ảnh) + trạng thái gửi Telegram */
export default async function ClosingsPage({ searchParams }: { searchParams: Promise<{ store?: string; date?: string; status?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const stores = await Store.find().sort({ name: 1 }).lean();
  const q: Record<string, unknown> = {};
  if (sp.store) q.storeId = sp.store;
  if (isYmd(sp.date)) q.workDate = sp.date;
  if (sp.status) q["telegram.status"] = sp.status;
  const list = await ShiftClosing.find(q).sort({ createdAt: -1 }).limit(100).lean();
  const users = new Map((await User.find({ _id: { $in: list.map((c) => c.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const storeMap = new Map(stores.map((s) => [String(s._id), s]));
  // doanh thu theo ngày (14 ngày gần nhất, hoặc đúng ngày đang lọc)
  const dq: Record<string, unknown> = isYmd(sp.date) ? { date: sp.date } : { date: { $gte: addDays(localDate(new Date()), -13) } };
  if (sp.store) dq.storeId = sp.store;
  const days = await DayRevenue.find(dq).sort({ date: -1, storeId: 1 }).lean();
  return (
    <>
      <PageTitle sub="Số liệu nhân viên nhập khi chốt ca – tự gửi (kèm ảnh) vào nhóm Telegram của cơ sở; ảnh không lưu trong app">Chốt ca</PageTitle>
      {!sheetsConfigured() && <Alert tone="orange">Chưa cấu hình <b>service account Google</b> (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY) – doanh thu chỉ lưu trong app, chưa ghi Google Sheet.</Alert>}
      {!telegramConfigured() && <Alert tone="orange">Chưa cấu hình <b>TELEGRAM_BOT_TOKEN</b> – ảnh chốt ca chỉ được lưu, chưa gửi Telegram. Xem hướng dẫn trong README.</Alert>}
      <Card>
        <AutoFilterForm className="flex flex-wrap items-end gap-2">
          <Field label="Cơ sở">
            <Select name="store" defaultValue={sp.store || ""} className="!w-44">
              <option value="">Tất cả</option>
              {stores.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.name}</option>)}
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
      <Card title="Doanh thu theo ngày (cộng các lượt chốt ca)">
        {days.length === 0 ? (
          <Empty>Chưa có doanh thu</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead>
                <tr>
                  <th>Ngày</th><th>Cơ sở</th><th className="text-center">Số ca</th>
                  {REVENUE_KEYS.map((k) => <th key={k} className="text-right">{REVENUE_LABEL[k]}</th>)}
                  <th className="text-right">Âm/Dương</th><th>Google Sheet</th><th></th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const st = SHEET[(d.sheet?.status ?? "PENDING") as keyof typeof SHEET];
                  const diff = revenueDiff(d as unknown as Revenue);
                  return (
                    <tr key={String(d._id)}>
                      <td className="whitespace-nowrap">{viDate(d.date)}</td>
                      <td className="text-xs">{storeMap.get(String(d.storeId))?.name}</td>
                      <td className="text-center">{d.closings}</td>
                      {REVENUE_KEYS.map((k) => <td key={k} className={`text-right tabular-nums ${k === "dt" ? "font-bold" : ""}`}>{vnd(d[k])}</td>)}
                      <td className={`text-right tabular-nums ${diff ? "font-bold text-danger" : ""}`}>{vnd(diff)}</td>
                      <td className="text-xs">
                        <Badge tone={st[1]}>{st[0]}</Badge>
                        {d.sheet?.range && d.sheet.status === "SENT" && <div className="text-ink/60">{d.sheet.range}</div>}
                        {d.sheet?.error && d.sheet.status !== "SENT" && <div className="mt-1 max-w-48 text-danger">{d.sheet.error}</div>}
                      </td>
                      <td>
                        <ActionForm action={syncDayRevenue} submitLabel={d.sheet?.status === "SENT" ? "Ghi lại" : "Ghi sheet"} variant="outline" successText="Đã ghi">
                          <input type="hidden" name="storeId" value={String(d.storeId)} />
                          <input type="hidden" name="date" value={d.date} />
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-ink/60">Tự ghi Google Sheet khi chốt <b>ca cuối ngày</b>; ngày nào chưa ghi được sẽ được cron đêm ghi lại. Ghi vào cột DT, Tài khoản, Tiền mặt, CP trong két (= Thu chi), Shopee (= Shopee + Grab, ghi rõ ở Ghi chú), Ghi chú – cột Chênh lệch / DT thực tế giữ công thức của sheet.</p>
      </Card>

      <Card>
        {list.length === 0 ? (
          <Empty>Chưa có lượt chốt ca</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Cơ sở</th><th>Ca</th><th>Ảnh</th><th>Doanh thu</th><th>Ghi chú</th><th>Telegram</th><th></th></tr></thead>
              <tbody>
                {list.map((c) => {
                  const store = storeMap.get(String(c.storeId));
                  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
                  const created = c.createdAt ? new Date(c.createdAt) : new Date();
                  const st = TG[(c.telegram?.status ?? "PENDING") as keyof typeof TG];
                  return (
                    <tr key={String(c._id)}>
                      <td className="whitespace-nowrap">{viDate(c.workDate)}<div className="text-xs">{localTime(created, tz)}</div></td>
                      <td className="font-semibold">{c.employeeName || users.get(String(c.userId))}{c.employeePhone && <div className="text-xs font-normal text-ink/60">{c.employeePhone}</div>}</td>
                      <td className="text-xs">{store?.name}{c.distanceM != null && <div className={c.distanceM > (store?.radiusM ?? 100) ? "text-danger" : "text-ink/60"}>cách quán {c.distanceM}m</div>}</td>
                      <td className="text-xs">
                        {c.shiftLabel || "Ngoài ca"}
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
                        {c.revenue?.dt != null ? (
                          <>
                            <div className="font-bold">DT máy {vnd(c.revenue.dt)}</div>
                            <div className="text-ink/70">TM {vnd(c.revenue.tm)} · TK {vnd(c.revenue.tk)}</div>
                            <div className="text-ink/70">Thu chi {vnd(c.revenue.cp)}{c.revenueInput?.cp && /[^\d.,\s]/.test(c.revenueInput.cp) ? ` (${c.revenueInput.cp})` : ""}</div>
                            <div className="text-ink/70">Grab {vnd(c.revenue.grab ?? 0)} · Shopee {vnd(c.revenue.shopee)}</div>
                            {(() => {
                              const d = revenueDiff(c.revenue as Partial<Revenue>);
                              return <div className={d ? "font-bold text-danger" : "text-secondary-dark"}>Âm/Dương {d > 0 ? "+" : ""}{vnd(d)}</div>;
                            })()}
                            {c.revenueEditedBy && <div className="text-warn">Sửa bởi {c.revenueEditedBy}</div>}
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
                                <Input name={k} defaultValue={c.revenueInput?.[k] || vnd(c.revenue?.[k] ?? 0)} className="!w-40 !py-1 text-right" title="Gõ được phép cộng, VD 30k + 20k" />
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
                      <td>
                        {c.telegram?.status !== "SENT" && (
                          <ActionForm action={resendClosing} submitLabel="Gửi lại" variant="outline" successText="Đã gửi">
                            <input type="hidden" name="id" value={String(c._id)} />
                          </ActionForm>
                        )}
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
