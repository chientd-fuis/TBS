import { requireAdmin } from "@/lib/guards";
import { ShiftClosing, Store, User } from "@/lib/models";
import { isYmd, localDate, localTime, viDate } from "@/lib/time";
import { telegramConfigured } from "@/lib/telegram";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Select } from "@/components/ui";
import { resendClosing } from "../../actions/closing";

export const dynamic = "force-dynamic";

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
  return (
    <>
      <PageTitle sub="Ảnh nhân viên chụp khi chốt ca – tự gửi vào nhóm Telegram của cơ sở">Chốt ca</PageTitle>
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
      <Card>
        {list.length === 0 ? (
          <Empty>Chưa có lượt chốt ca</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbs">
              <thead><tr><th>Thời gian</th><th>Nhân viên</th><th>Cơ sở</th><th>Ca</th><th>Ảnh</th><th>Ghi chú</th><th>Telegram</th><th></th></tr></thead>
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
