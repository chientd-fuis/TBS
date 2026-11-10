import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { BonusPenalty, Payroll, PayrollItem, Store, User } from "@/lib/models";
import { localMonth, prevMonth, viDateTime, viMonth } from "@/lib/time";
import { hoursVi, vnd } from "@/lib/format";
import { decrypt } from "@/lib/crypto";
import { ActionForm } from "@/components/ActionForm";
import { MonthPicker } from "@/components/MonthPicker";
import { Alert, Badge, Card, Empty, Input, LinkButton, PageTitle } from "@/components/ui";
import { payrollAction, payrollItemAction, savePayrollExtras } from "../../actions/ops";
import { generatePayroll } from "@/lib/payroll";

export const dynamic = "force-dynamic";

const ST = { DRAFT: ["Chưa công bố", "yellow"], PUBLISHED: ["Đã công bố", "green"], PAID: ["Đã trả – khoá", "green"] } as const;
/** 20000 → "20k" (tooltip thưởng / phạt) */
const k = (n: number) => (n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString("vi-VN"));

/**
 * Bảng lương tháng: luôn tự tính sẵn (theo chấm công / thưởng phạt mới nhất) → "Công bố" = nhân viên xem được
 * → "Đã trả" (từng người hoặc cả bảng) = khoá → "Mở khoá" bắt buộc lý do.
 */
export default async function PayrollAdmin({ searchParams }: { searchParams: Promise<{ store?: string; month?: string }> }) {
  await requirePerm("payroll");
  const sp = await searchParams;
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  if (!store) return <p>Chưa có cơ sở</p>;
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : prevMonth(localMonth(new Date(), tz));
  // Bảng lương luôn tính sẵn: mở trang là tạo / tính lại (trừ dòng đã trả & bảng đã trả hết)
  const existing = await Payroll.findOne({ storeId: store._id, month }).select("status").lean();
  if (existing?.status !== "PAID" && month <= localMonth(new Date(), tz)) await generatePayroll(String(store._id), month);
  const payroll = await Payroll.findOne({ storeId: store._id, month }).lean();
  const items = payroll ? await PayrollItem.find({ payrollId: payroll._id }).lean() : [];
  const users = new Map((await User.find({ _id: { $in: items.map((i) => i.userId) } }).lean()).map((u) => [String(u._id), u]));
  items.sort((a, b) => (users.get(String(a.userId))?.name || "").localeCompare(users.get(String(b.userId))?.name || ""));
  const total = items.reduce((s, i) => s + i.netPay, 0);
  const paidCount = items.filter((i) => i.paidAt).length;
  // chi tiết thưởng / phạt từng người (tooltip khi rê chuột)
  const bps = payroll ? await BonusPenalty.find({ storeId: store._id, month }).sort({ date: 1, createdAt: 1 }).lean() : [];
  const bpTip = (uid: string, kind: "BONUS" | "PENALTY") =>
    bps
      .filter((b) => String(b.userId) === uid && b.kind === kind)
      .map((b) => `- ${b.date.slice(8)}/${b.date.slice(5, 7)} ${b.content} ${kind === "BONUS" ? "+" : "-"}${k(b.amountVnd)}`)
      .join("\n");
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="storeId" value={String(store._id)} />
      <input type="hidden" name="month" value={month} />
    </>
  );
  const exp = (type: string) => `/api/admin/export?type=${type}&store=${store._id}&from=${month}&to=${month}`;

  return (
    <>
      <PageTitle sub="Thực nhận = Giờ công × Lương giờ + Phụ cấp + Thưởng − Phạt − Tạm ứng (VND, không thuế)">Bảng lương</PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        {stores.map((s) => (
          <Link key={String(s._id)} href={`/admin/payroll?store=${s._id}&month=${month}`} className={`rounded-xl px-3 py-1.5 text-sm ${String(s._id) === String(store._id) ? "bg-primary font-bold" : "bg-white ring-1 ring-[#f1e6c8]"}`}>
            {s.name}
          </Link>
        ))}
        <div className="ml-auto"><MonthPicker month={month} base="/admin/payroll" params={{ store: String(store._id) }} /></div>
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
              <ActionForm action={payrollAction} submitLabel="Công bố cho nhân viên" variant="secondary" successText="" className="inline-block" confirm={`Công bố bảng lương tháng ${viMonth(month)}? Nhân viên sẽ xem được. Bảng lương vẫn tự tính lại tới khi bấm "Đã trả".`}>
                {hidden("publish")}
              </ActionForm>
            )}
            {payroll?.status === "PUBLISHED" && (
              <>
                <ActionForm action={payrollAction} submitLabel="Đã trả tất cả" variant="secondary" successText="" className="inline-block" confirm={`Đánh dấu ĐÃ TRẢ lương tháng ${viMonth(month)} cho tất cả? Bảng lương sẽ bị khoá (mở khoá cần lý do).`}>
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
          <Alert tone="yellow">
            Chưa công bố – nhân viên chưa xem được. Tự công bố lúc <b>00:00 ngày 5</b> tháng sau{payroll.unlockedAt ? " (đã huỷ công bố thủ công → không tự công bố lại)" : ""}. Bảng lương tự tính theo chấm công, thưởng phạt mới nhất · cập nhật {viDateTime(payroll.calculatedAt)}.
          </Alert>
        )}
        {payroll?.status === "PUBLISHED" && (
          <Alert tone="green">
            Đã công bố lúc {viDateTime(payroll.publishedAt)} bởi {payroll.publishedBy} – nhân viên xem được. Vẫn tự tính lại tới khi bấm <b>Đã trả</b>. Đã trả <b>{paidCount}/{items.length}</b> người.
          </Alert>
        )}
        {payroll?.status === "PAID" && <Alert tone="green">🔒 Đã trả hết – bảng lương đã khoá. Cần sửa thì mở khoá (nhập lý do) ở cuối trang hoặc từng dòng.</Alert>}
        {!payroll ? (
          <Empty>Chưa có dữ liệu tháng này</Empty>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="tbs">
              <thead>
                <tr>
                  <th>Nhân viên</th><th className="text-right">Giờ công</th><th className="text-right">Lương giờ</th><th className="text-right">Lương CB</th>
                  <th>Phụ cấp / Tạm ứng</th><th className="text-right">Thưởng</th><th className="text-right">Phạt</th><th className="text-right">Thực nhận</th><th>Chuyển khoản</th><th>Trả lương</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const u = users.get(String(i.userId));
                  const uid = String(i.userId);
                  const paid = !!i.paidAt;
                  const tipB = bpTip(uid, "BONUS");
                  const tipP = bpTip(uid, "PENALTY");
                  return (
                    <tr key={String(i._id)} className={paid ? "bg-[#f3faf5]" : ""}>
                      <td className="font-semibold">{u?.name}<div className="text-xs font-normal text-ink/60">{i.workDays} ngày · muộn {i.lateCount} · sớm {i.earlyCount}</div>{!!i.supportHours && <div className="text-xs font-normal text-[#1e40af]">⇄ hỗ trợ: {i.supportNote}</div>}{!!i.holidayHours && <div className="text-xs font-normal text-danger" title="Đã gồm trong lương cơ bản">🎉 Lễ: {i.holidayNote} (+{vnd(i.holidayExtra)})</div>}</td>
                      <td className="text-right">{hoursVi(i.totalHours)}</td>
                      <td className="text-right">{vnd(i.hourlyWage)}</td>
                      <td className="text-right">{vnd(i.basePay)}</td>
                      <td>
                        {!paid && payroll.status !== "PAID" ? (
                          <ActionForm action={savePayrollExtras} submitLabel="Lưu" variant="outline" successText="" className="flex items-center gap-1">
                            <input type="hidden" name="itemId" value={String(i._id)} />
                            <Input name="allowance" defaultValue={i.allowance} inputMode="numeric" className="w-24" title="Phụ cấp" />
                            <Input name="advance" defaultValue={i.advance} inputMode="numeric" className="w-24" title="Tạm ứng" />
                          </ActionForm>
                        ) : (
                          <span className="text-xs">PC {vnd(i.allowance)} · TƯ {vnd(i.advance)}</span>
                        )}
                      </td>
                      <td className="text-right text-bonus">
                        <span title={tipB || undefined} className={tipB ? "cursor-help underline decoration-dotted underline-offset-2" : ""}>{vnd(i.totalBonus)}</span>
                      </td>
                      <td className="text-right text-danger">
                        <span title={tipP || undefined} className={tipP ? "cursor-help underline decoration-dotted underline-offset-2" : ""}>{vnd(i.totalPenalty)}</span>
                      </td>
                      <td className="text-right text-base font-bold">{vnd(i.netPay)}</td>
                      <td className="text-xs">{u?.bankName}<br />{decrypt(u?.bankAccountEnc)}</td>
                      <td className="whitespace-nowrap text-xs">
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
                          <ActionForm action={payrollItemAction} submitLabel="Đã trả" variant="secondary" successText="" className="inline-block" confirm={`Đánh dấu đã trả ${vnd(i.netPay)} cho ${u?.name}? Dòng lương sẽ bị khoá (mở khoá cần lý do).`}>
                            <input type="hidden" name="itemId" value={String(i._id)} />
                            <input type="hidden" name="op" value="paid" />
                          </ActionForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={7} className="text-right font-bold">TỔNG</td>
                  <td className="text-right text-base font-bold text-secondary-dark">{vnd(total)}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
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
          <ActionForm action={payrollAction} submitLabel="Mở khoá" variant="danger" confirm="Mở khoá sẽ bỏ trạng thái Đã trả của mọi nhân viên, bảng lương tự tính lại (nhân viên vẫn xem được). Tiếp tục?" className="flex flex-wrap items-end gap-2">
            {hidden("unlock")}
            <Input name="reason" placeholder="Lý do mở khoá (bắt buộc)" className="w-80" />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
