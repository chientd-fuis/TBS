import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { Payroll, PayrollItem, Store, User } from "@/lib/models";
import { localMonth, prevMonth, viDateTime, viMonth } from "@/lib/time";
import { hoursVi, vnd } from "@/lib/format";
import { decrypt } from "@/lib/crypto";
import { ActionForm } from "@/components/ActionForm";
import { MonthPicker } from "@/components/MonthPicker";
import { Alert, Badge, Card, Empty, Input, LinkButton, PageTitle } from "@/components/ui";
import { payrollAction, savePayrollExtras, savePayrollWage } from "../../actions/ops";
import { generatePayroll } from "@/lib/payroll";

export const dynamic = "force-dynamic";

const ST = { DRAFT: ["Nháp", "yellow"], PUBLISHED: ["Đã công bố", "green"], PAID: ["Đã trả", "green"] } as const;

/** Bảng lương tháng – tự công bố ngày 5, admin được công bố sớm (spec 3.7) */
export default async function PayrollAdmin({ searchParams }: { searchParams: Promise<{ store?: string; month?: string }> }) {
  await requirePerm("payroll");
  const sp = await searchParams;
  const stores = await Store.find({ active: true }).sort({ name: 1 }).lean();
  const store = stores.find((s) => String(s._id) === sp.store) ?? stores[0];
  if (!store) return <p>Chưa có cơ sở</p>;
  const tz = store.timezone || "Asia/Ho_Chi_Minh";
  const month = /^\d{4}-\d{2}$/.test(sp.month || "") ? sp.month! : prevMonth(localMonth(new Date(), tz));
  // Bảng lương nháp luôn được tính lại khi mở trang → luôn khớp chấm công / thưởng phạt mới nhất
  const existing = await Payroll.findOne({ storeId: store._id, month }).select("status").lean();
  if (existing?.status === "DRAFT") await generatePayroll(String(store._id), month);
  const payroll = await Payroll.findOne({ storeId: store._id, month }).lean();
  const items = payroll ? await PayrollItem.find({ payrollId: payroll._id }).lean() : [];
  const users = new Map((await User.find({ _id: { $in: items.map((i) => i.userId) } }).lean()).map((u) => [String(u._id), u]));
  items.sort((a, b) => (users.get(String(a.userId))?.name || "").localeCompare(users.get(String(b.userId))?.name || ""));
  const total = items.reduce((s, i) => s + i.netPay, 0);
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
            {(!payroll || payroll.status === "DRAFT") && (
              <ActionForm action={payrollAction} submitLabel={payroll ? "Tính lại" : "Tạo bảng lương"} variant="outline" successText="" className="inline-block">
                {hidden("generate")}
              </ActionForm>
            )}
            {payroll?.status === "DRAFT" && (
              <ActionForm action={payrollAction} submitLabel="Công bố ngay" variant="secondary" successText="" className="inline-block" confirm={`Công bố bảng lương tháng ${viMonth(month)}? Nhân viên sẽ xem được và dữ liệu chấm công, thưởng phạt tháng này sẽ bị khoá.`}>
                {hidden("publish")}
              </ActionForm>
            )}
            {payroll?.status === "PUBLISHED" && (
              <ActionForm action={payrollAction} submitLabel="Đánh dấu đã trả" variant="secondary" successText="" className="inline-block">
                {hidden("paid")}
              </ActionForm>
            )}
          </div>
        }
      >
        {payroll?.status === "DRAFT" && (
          <Alert tone="yellow">
            Bảng lương nháp – sẽ <b>tự động chốt & công bố lúc 00:00 ngày 5</b> tháng sau{payroll.unlockedAt ? " (đã mở khoá thủ công → không tự công bố lại, hãy bấm Công bố ngay)" : ""}. Cập nhật lần cuối: {viDateTime(payroll.calculatedAt)}.
          </Alert>
        )}
        {payroll && payroll.status !== "DRAFT" && (
          <Alert tone="green">Công bố lúc {viDateTime(payroll.publishedAt)} bởi {payroll.publishedBy}. Dữ liệu tháng đã khoá.</Alert>
        )}
        {!payroll ? (
          <Empty>Chưa có bảng lương tháng này – bấm &quot;Tạo bảng lương&quot;</Empty>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="tbs">
              <thead>
                <tr>
                  <th>Nhân viên</th><th className="text-right">Giờ công</th><th className="text-right">Lương giờ</th><th className="text-right">Lương CB</th>
                  <th>Phụ cấp / Tạm ứng</th><th className="text-right">Thưởng</th><th className="text-right">Phạt</th><th className="text-right">Thực nhận</th><th>Chuyển khoản</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const u = users.get(String(i.userId));
                  return (
                    <tr key={String(i._id)}>
                      <td className="font-semibold">{u?.name}<div className="text-xs font-normal text-ink/60">{i.workDays} ngày · muộn {i.lateCount} · sớm {i.earlyCount}</div>{!!i.supportHours && <div className="text-xs font-normal text-[#1e40af]">⇄ hỗ trợ: {i.supportNote}</div>}{!!i.holidayHours && <div className="text-xs font-normal text-danger" title="Đã gồm trong lương cơ bản">🎉 Lễ: {i.holidayNote} (+{vnd(i.holidayExtra)})</div>}</td>
                      <td className="text-right">{hoursVi(i.totalHours)}</td>
                      <td className="text-right">
                        {payroll.status === "DRAFT" ? (
                          <ActionForm action={savePayrollWage} submitLabel="Lưu" variant="outline" successText="" className="flex items-center justify-end gap-1">
                            <input type="hidden" name="itemId" value={String(i._id)} />
                            <Input name="hourlyWage" defaultValue={i.hourlyWage} inputMode="numeric" className="w-24 text-right" title={`Lương giờ áp dụng từ 01/${month.slice(5)}/${month.slice(0, 4)}`} />
                          </ActionForm>
                        ) : (
                          vnd(i.hourlyWage)
                        )}
                      </td>
                      <td className="text-right">{vnd(i.basePay)}</td>
                      <td>
                        {payroll.status === "DRAFT" ? (
                          <ActionForm action={savePayrollExtras} submitLabel="Lưu" variant="outline" successText="" className="flex items-center gap-1">
                            <input type="hidden" name="itemId" value={String(i._id)} />
                            <Input name="allowance" defaultValue={i.allowance} inputMode="numeric" className="w-24" title="Phụ cấp" />
                            <Input name="advance" defaultValue={i.advance} inputMode="numeric" className="w-24" title="Tạm ứng" />
                          </ActionForm>
                        ) : (
                          <span className="text-xs">PC {vnd(i.allowance)} · TƯ {vnd(i.advance)}</span>
                        )}
                      </td>
                      <td className="text-right text-bonus">{vnd(i.totalBonus)}</td>
                      <td className="text-right text-danger">{vnd(i.totalPenalty)}</td>
                      <td className="text-right text-base font-bold">{vnd(i.netPay)}</td>
                      <td className="text-xs">{u?.bankName}<br />{decrypt(u?.bankAccountEnc)}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={7} className="text-right font-bold">TỔNG</td>
                  <td className="text-right text-base font-bold text-secondary-dark">{vnd(total)}</td>
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

      {payroll && payroll.status !== "DRAFT" && (
        <Card title="Mở khoá bảng lương">
          <ActionForm action={payrollAction} submitLabel="Mở khoá" variant="danger" confirm="Mở khoá sẽ đưa bảng lương về nháp, nhân viên tạm thời không xem được. Tiếp tục?" className="flex flex-wrap items-end gap-2">
            {hidden("unlock")}
            <Input name="reason" placeholder="Lý do mở khoá (bắt buộc)" className="w-80" />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
