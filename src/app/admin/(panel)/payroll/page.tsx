import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { Attendance, BonusPenalty, Payroll, PayrollItem, Store, User, type BpDetail, type ExtrasNote } from "@/lib/models";
import { payStoreFilter } from "@/lib/attendance";
import { hoursShort } from "@/lib/overtime";
import { localMonth, prevMonth, viDateTime, viMonth } from "@/lib/time";
import { hoursVi, vnd } from "@/lib/format";
import { daysOfMonth } from "@/lib/salary";
import { decrypt } from "@/lib/crypto";
import { ActionForm } from "@/components/ActionForm";
import { MonthPicker } from "@/components/MonthPicker";
import { Alert, Badge, Card, Empty, Input, LinkButton, PageTitle } from "@/components/ui";
import { payrollAction, payrollItemAction } from "../../actions/ops";
import { generatePayroll } from "@/lib/payroll";
import { BpAmount, CopyAccount, ExtrasCell, type ExtraEntry } from "./PayrollCells";
import PayrollColumns from "./PayrollColumns";

export const dynamic = "force-dynamic";

const ST = { DRAFT: ["Chưa công bố", "yellow"], PUBLISHED: ["Đã công bố", "green"], PAID: ["Đã trả – khoá", "green"] } as const;
/** 20000 → "20k" (tooltip thưởng / phạt, ghi chú phụ cấp) */
const k = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString("vi-VN"));

/**
 * Bảng lương tháng: luôn tự tính sẵn (theo chấm công / thưởng phạt mới nhất) → "Công bố" = nhân viên xem được
 * → "Đã trả" (từng người hoặc cả bảng) = khoá → "Mở khoá" bắt buộc lý do.
 */
export default async function PayrollAdmin({ searchParams }: { searchParams: Promise<{ store?: string; month?: string; hide?: string }> }) {
  await requirePerm("payroll");
  const sp = await searchParams;
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  if (!store) return <p>Chưa có cơ sở</p>;
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  // Mặc định: tháng trước (tháng cần trả); tháng trước đã trả hết → mở thẳng tháng hiện tại
  let month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";
  if (!month) {
    const cur = localMonth(new Date(), tz);
    const prev = prevMonth(cur);
    const prevPaid = await Payroll.exists({ storeId: store._id, month: prev, status: "PAID" });
    month = prevPaid ? cur : prev;
  }
  // Luôn tính sẵn: mở trang là tạo / tính lại (nháp + đã công bố). Đã trả → giữ số đã chốt (generatePayroll bỏ qua)
  const existing = await Payroll.findOne({ storeId: store._id, month }).select("status").lean();
  if (existing?.status !== "PAID" && month <= localMonth(new Date(), tz)) await generatePayroll(String(store._id), month);
  const payroll = await Payroll.findOne({ storeId: store._id, month }).lean();
  const items = payroll ? await PayrollItem.find({ payrollId: payroll._id }).lean() : [];
  const users = new Map((await User.find({ _id: { $in: items.map((i) => i.userId) } }).lean()).map((u) => [String(u._id), u]));
  // tên / STK / chi tiết thưởng phạt: lấy bản đã chốt trong dòng lương (bảng cũ chưa có bản chốt → dữ liệu hiện tại)
  const nameOf = (i: (typeof items)[number]) => i.userName || users.get(String(i.userId))?.name || "";
  items.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const total = items.reduce((s, i) => s + i.netPay, 0);
  const paidCount = items.filter((i) => i.paidAt).length;
  // bộ lọc "Ẩn NV 0đ / đã nghỉ": lương 0đ, hoặc đã nghỉ việc mà không còn lương chưa trả (người nghỉ còn nợ lương vẫn hiện)
  const hide = sp.hide === "1";
  const quiet = (i: (typeof items)[number]) => i.netPay === 0 || (users.get(String(i.userId))?.status === "INACTIVE" && !!i.paidAt);
  const rows = hide ? items.filter((i) => !quiet(i)) : items;
  const quietCount = items.filter(quiet).length;
  const qs = (o: Record<string, string>) => `/admin/payroll?${new URLSearchParams({ store: String(store._id), month, ...(hide ? { hide: "1" } : {}), ...o })}`;
  // chi tiết thưởng / phạt từng người (tooltip khi rê chuột)
  const bps = payroll ? await BonusPenalty.find({ storeId: store._id, month }).sort({ date: 1, createdAt: 1 }).lean() : [];
  const bpTip = (i: (typeof items)[number], kind: "BONUS" | "PENALTY") =>
    ((i.bpDetails as BpDetail[] | undefined) ?? bps.filter((b) => String(b.userId) === String(i.userId)))
      .filter((b) => b.kind === kind)
      .map((b) => `- ${(b.date ?? "").slice(8)}/${(b.date ?? "").slice(5, 7)} ${b.content ?? ""} ${kind === "BONUS" ? "+" : "-"}${k(b.amountVnd ?? 0)}`)
      .join("\n");
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="storeId" value={String(store._id)} />
      <input type="hidden" name="month" value={month} />
    </>
  );
  const exp = (type: string) => `/api/admin/export?type=${type}&store=${store._id}&from=${month}&to=${month}`;
  // làm ngoài giờ / ngoài ca CHƯA KIỂM DUYỆT: mặc định đang được cộng vào lương → cảnh báo cần duyệt trước khi trả
  const pendingOts = payroll
    ? await Attendance.find({ month, status: "COMPLETED", "overtime.status": "PENDING", ...payStoreFilter(store._id) }).select("userId overtime.deltaHours").lean()
    : [];
  const otBy = new Map<string, { n: number; h: number }>();
  for (const a of pendingOts) {
    const x = otBy.get(String(a.userId)) ?? { n: 0, h: 0 };
    otBy.set(String(a.userId), { n: x.n + 1, h: x.h + (a.overtime?.deltaHours ?? 0) });
  }
  const otHours = Math.round(pendingOts.reduce((s, a) => s + (a.overtime?.deltaHours ?? 0), 0) * 100) / 100;
  const otWarn = (n: number, h: number) => `${n} lượt làm ngoài giờ chưa kiểm duyệt${h ? ` (đang tính +${hoursShort(h)} công)` : ""}`;

  return (
    <>
      <PageTitle sub="Thực nhận = Giờ công × Lương giờ + Phụ cấp + Thưởng − Phạt − Tạm ứng (VND, không thuế)">Bảng lương</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        {stores.map((s) => (
          <Link key={String(s._id)} href={qs({ store: String(s._id) })} className={`rounded-xl px-3 py-1.5 text-sm ${String(s._id) === String(store._id) ? "bg-primary text-on-primary font-bold" : "bg-card ring-1 ring-line"}`}>
            {s.name}
          </Link>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <MonthPicker month={month} base="/admin/payroll" params={{ store: String(store._id), hide: hide ? "1" : undefined }} />
        </div>
      </div>

      <Card
        title={
          <span>
            {store.name} · Tháng {viMonth(month)}{" "}
            {payroll && <Badge tone={ST[payroll.status as keyof typeof ST][1]}>{ST[payroll.status as keyof typeof ST][0]}</Badge>}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {payroll?.status === "DRAFT" && (
              <ActionForm action={payrollAction} submitLabel="Công bố cho nhân viên" variant="secondary" successText="" className="inline-block" confirm={`Công bố bảng lương tháng ${viMonth(month)}? Nhân viên sẽ xem được. Sửa tiếp sau đó (chấm công, thưởng / phạt, phụ cấp…) nhân viên thấy luôn số mới.`}>
                {hidden("publish")}
              </ActionForm>
            )}
            {payroll?.status === "PUBLISHED" && (
              <>
                <ActionForm action={payrollAction} submitLabel="Đã trả tất cả" variant="secondary" successText="" className="inline-block" confirm={`${pendingOts.length ? `⚠️ Còn ${otWarn(pendingOts.length, otHours)}!\n` : ""}Đánh dấu ĐÃ TRẢ lương tháng ${viMonth(month)} cho tất cả? Bảng lương sẽ bị khoá (mở khoá cần lý do).`}>
                  {hidden("paid")}
                </ActionForm>
                <ActionForm action={payrollAction} submitLabel="Huỷ công bố" variant="ghost" successText="" className="inline-block" confirm="Ẩn bảng lương khỏi nhân viên?">
                  {hidden("unpublish")}
                </ActionForm>
              </>
            )}
          </div>
        }
      >
        {payroll?.status === "DRAFT" && (
          // hướng dẫn dài – ẩn trên điện thoại (trạng thái "Chưa công bố" đã có ở tiêu đề)
          <div className="hidden sm:block">
            <Alert tone="yellow">
              Chưa công bố – nhân viên chưa xem được{items.some((x) => x.publishedAt) ? ` (trừ ${items.filter((x) => x.publishedAt).length} người đã công bố riêng)` : ""}. Cần cho riêng ai xem trước → bấm “👁 Công bố riêng” ở dòng người đó. Tự công bố lúc <b>00:00 ngày 5</b> tháng sau{payroll.unlockedAt ? " (đã huỷ công bố thủ công → không tự công bố lại)" : ""}. Bảng lương tự tính theo chấm công, thưởng phạt mới nhất · cập nhật {viDateTime(payroll.calculatedAt)}.
            </Alert>
          </div>
        )}
        {payroll?.status === "PUBLISHED" && (
          <Alert tone="green">
            Đã công bố lúc {viDateTime(payroll.publishedAt)} bởi {payroll.publishedBy} – nhân viên xem được. Sửa tiếp thì nhân viên thấy luôn số mới (tự tính lại · cập nhật {viDateTime(payroll.calculatedAt)}). Đã trả <b>{paidCount}/{items.length}</b> người.
          </Alert>
        )}
        {payroll?.status === "PAID" && <Alert tone="green">🔒 Đã trả hết – bảng lương đã khoá. Cần sửa thì mở khoá (nhập lý do) ở cuối trang hoặc từng dòng.</Alert>}
        {pendingOts.length > 0 && (
          <Alert tone="red">
            <b>⚠️ Cần kiểm duyệt: {otWarn(pendingOts.length, otHours)}</b> – vào sớm / ra muộn / ngoài ca, mặc định ĐANG ĐƯỢC CỘNG vào bảng lương này. Duyệt hoặc từ chối
            trước khi trả lương (đã trả thì tháng bị khoá, không trừ lại được):{" "}
            {[...otBy]
              .map(([uid, x]) => `${nameOf(items.find((i) => String(i.userId) === uid) ?? ({ userId: uid } as (typeof items)[number])) || "?"} (${x.n} lượt${x.h ? `, +${hoursShort(x.h)}` : ""})`)
              .join(" · ")}
            .{" "}
            <Link href="/admin/requests#ngoai-gio" className="font-semibold text-accent underline">
              Kiểm duyệt ở Yêu cầu →
            </Link>
          </Alert>
        )}
        {!payroll ? (
          <Empty>Chưa có dữ liệu tháng này</Empty>
        ) : (
          <PayrollColumns
            extra={
              <Link
                href={hide ? `/admin/payroll?${new URLSearchParams({ store: String(store._id), month })}` : qs({ hide: "1" })}
                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 ${hide ? "bg-secondary font-semibold text-white" : "bg-card ring-1 ring-line-strong hover:bg-primary-light"}`}
                title="Ẩn nhân viên lương 0đ và nhân viên đã nghỉ việc đã trả hết lương"
              >
                <span aria-hidden>{hide ? "☑" : "☐"}</span> Ẩn NV 0đ / đã nghỉ{hide && quietCount ? ` (${quietCount})` : ""}
              </Link>
            }
          >
          <div className="mt-3 overflow-x-auto">
            <table className="tbs">
              <thead>
                <tr>
                  <th>Nhân viên</th><th className="text-right">Giờ công</th><th className="text-right">Lương giờ / cứng</th><th className="text-right">Lương CB</th>
                  <th className="text-right text-good">+ Phụ cấp</th><th className="text-right text-danger">− Tạm ứng</th><th className="text-right">Thưởng</th><th className="text-right">Phạt</th><th className="text-right">Thực nhận</th><th>Chuyển khoản</th><th>Trả lương</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => {
                  const u = users.get(String(i.userId));
                  const paid = !!i.paidAt;
                  const tipB = bpTip(i, "BONUS");
                  const tipP = bpTip(i, "PENALTY");
                  const name = nameOf(i);
                  const bankName = i.userName ? i.bankName : u?.bankName;
                  const bankAcc = decrypt(i.userName ? i.bankAccountEnc : u?.bankAccountEnc);
                  return (
                    <tr key={String(i._id)} className={paid ? "bg-ok-soft" : ""}>
                      <td className="font-semibold">{name}<div className="text-xs font-normal text-ink/60">{i.workDays} ngày · muộn {i.lateCount} · sớm {i.earlyCount}</div>{!!i.supportHours && <div className="text-xs font-normal text-info-fg">⇄ hỗ trợ: {i.supportNote}</div>}{!!i.holidayHours && <div className="text-xs font-normal text-danger" title="Đã gồm trong lương cơ bản">🎉 Lễ: {i.holidayNote} (+{vnd(i.holidayExtra)})</div>}{i.payType === "FULLTIME" && <div className="text-xs font-normal text-info-fg">Full-time · nghỉ có lương {i.paidLeaveDays ?? 0} ngày</div>}{otBy.has(String(i.userId)) && <Link href="/admin/requests#ngoai-gio" className="block text-xs font-semibold text-danger underline">⏱ {otWarn(otBy.get(String(i.userId))!.n, otBy.get(String(i.userId))!.h)}</Link>}</td>
                      <td className="text-right">{hoursVi(i.totalHours)}</td>
                      <td className="whitespace-nowrap text-right">
                        {i.payType === "FULLTIME" ? <span title="Full-time: lương cơ bản = lương cứng / tháng">{vnd(i.monthlySalary ?? 0)}<div className="text-xs text-info-fg">Full-time / tháng</div></span> : vnd(i.hourlyWage)}
                      </td>
                      <td className="text-right">{vnd(i.basePay)}</td>
                      {(["allowance", "advance"] as const).map((field) => {
                        // từng khoản có ghi chú (index = vị trí trong extrasNotes) + phần nhập tay cũ không ghi chú (index -1)
                        const all = (i.extrasNotes ?? []) as ExtrasNote[];
                        const entries: ExtraEntry[] = all.flatMap((n, idx) =>
                          (n.field ?? "allowance") === field ? [{ index: idx, amount: n.amount ?? 0, note: n.note ?? "", meta: [n.by, n.at ? viDateTime(n.at) : ""].filter(Boolean).join(" · ") }] : [],
                        );
                        const rest = i[field] - entries.reduce((s, e) => s + e.amount, 0);
                        if (rest > 0) entries.unshift({ index: -1, amount: rest, note: "", meta: "nhập tay trước đây" });
                        return (
                          <td key={field} className="text-right">
                            <ExtrasCell
                              itemId={String(i._id)}
                              field={field}
                              total={i[field]}
                              entries={entries}
                              name={name}
                              locked={paid || payroll.status === "PAID"}
                              leave={
                                field === "advance" && i.payType === "FULLTIME"
                                  ? { monthlySalary: i.monthlySalary ?? 0, paidLeaveDays: i.paidLeaveDays ?? 0, daysInMonth: daysOfMonth(i.month), workDays: i.workDays }
                                  : undefined
                              }
                            />
                          </td>
                        );
                      })}
                      <td className="text-right text-bonus">
                        <BpAmount amount={vnd(i.totalBonus)} tip={tipB} title={`Thưởng · ${name}`} className="text-bonus" />
                      </td>
                      <td className="text-right text-danger">
                        <BpAmount amount={vnd(i.totalPenalty)} tip={tipP} title={`Phạt · ${name}`} className="text-danger" />
                      </td>
                      <td className="text-right text-base font-bold">{vnd(i.netPay)}</td>
                      <td className="text-xs">{bankName}<br /><CopyAccount account={bankAcc} /></td>
                      <td className="whitespace-nowrap text-xs">
                        {payroll.status === "DRAFT" && !paid && (
                          <div className="mb-1">
                            {i.publishedAt ? (
                              <div className="flex items-center gap-1">
                                <span title={`Công bố riêng lúc ${viDateTime(i.publishedAt)}${i.publishedBy ? ` · ${i.publishedBy}` : ""}`}><Badge tone="green">👁 NV đã xem được</Badge></span>
                                <ActionForm action={payrollItemAction} submitLabel="Ẩn" variant="ghost" successText="" className="inline-block" buttonClassName="!px-1.5 !py-0.5 text-xs">
                                  <input type="hidden" name="itemId" value={String(i._id)} />
                                  <input type="hidden" name="op" value="unpublish" />
                                </ActionForm>
                              </div>
                            ) : (
                              <ActionForm action={payrollItemAction} submitLabel="👁 Công bố riêng" variant="outline" successText="" className="inline-block" buttonClassName="!px-2 !py-1 text-xs" confirm={`Cho ${name} xem lương tháng ${viMonth(month)}? Sửa tiếp thì ${name} thấy luôn số mới.`}>
                                <input type="hidden" name="itemId" value={String(i._id)} />
                                <input type="hidden" name="op" value="publish" />
                              </ActionForm>
                            )}
                          </div>
                        )}
                        {paid ? (
                          <div className="space-y-1">
                            <Badge tone="green">🔒 Đã trả</Badge>
                            <div className="text-ink/60">{viDateTime(i.paidAt)}{i.paidBy ? ` · ${i.paidBy}` : ""}</div>
                            <details>
                              <summary className="cursor-pointer font-semibold text-accent">Mở khoá</summary>
                              <ActionForm action={payrollItemAction} submitLabel="Mở khoá" variant="danger" successText="" className="mt-1 space-y-1">
                                <input type="hidden" name="itemId" value={String(i._id)} />
                                <input type="hidden" name="op" value="unpaid" />
                                <Input name="reason" placeholder="Lý do (bắt buộc)" className="w-44" required minLength={3} />
                              </ActionForm>
                            </details>
                          </div>
                        ) : (
                          <ActionForm action={payrollItemAction} submitLabel="Đã trả" variant="secondary" successText="" className="inline-block" confirm={`${otBy.has(String(i.userId)) ? `⚠️ ${name} còn ${otWarn(otBy.get(String(i.userId))!.n, otBy.get(String(i.userId))!.h)}!\n` : ""}Đánh dấu đã trả ${vnd(i.netPay)} cho ${name}? Dòng lương sẽ bị khoá (mở khoá cần lý do).`}>
                            <input type="hidden" name="itemId" value={String(i._id)} />
                            <input type="hidden" name="op" value="paid" />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {hide && quietCount > 0 && (
                  <tr>
                    <td colSpan={12} className="text-center text-xs text-ink/60">
                      Đang ẩn {quietCount} nhân viên (lương 0đ / đã nghỉ, đã trả) – TỔNG vẫn tính đủ.{" "}
                      <Link href={`/admin/payroll?${new URLSearchParams({ store: String(store._id), month })}`} className="font-semibold text-accent underline">
                        Hiện tất cả
                      </Link>
                    </td>
                  </tr>
                )}
                {/* đủ 11 ô (không gộp cột) để ẩn cột vẫn thẳng hàng */}
                <tr>
                  <td className="font-bold">TỔNG</td>
                  {Array.from({ length: 7 }, (_, n) => <td key={n}></td>)}
                  <td className="text-right text-base font-bold text-good">{vnd(total)}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          </PayrollColumns>
        )}
      </Card>

      {payroll && (
        <div className="flex flex-wrap gap-2">
          <LinkButton variant="outline" href={exp("luong")}>Xuất bảng lương</LinkButton>
          <LinkButton variant="outline" href={exp("chuyenkhoan")}>Xuất danh sách chuyển khoản</LinkButton>
          <LinkButton variant="outline" href={exp("thuongphat")}>Xuất thưởng / phạt</LinkButton>
        </div>
      )}

      {payroll?.status === "PAID" && (
        <Card title="Mở khoá cả bảng lương">
          <ActionForm action={payrollAction} submitLabel="Mở khoá" variant="danger" confirm="Mở khoá sẽ bỏ trạng thái Đã trả của mọi nhân viên, bảng về Đã công bố và tự tính lại theo dữ liệu mới nhất. Nhân viên vẫn xem được. Tiếp tục?" className="flex flex-wrap items-end gap-2">
            {hidden("unlock")}
            <Input name="reason" placeholder="Lý do mở khoá (bắt buộc)" className="w-80" />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
