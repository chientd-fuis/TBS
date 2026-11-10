import Link from "next/link";
import { requireActiveUser } from "@/lib/guards";
import { BonusPenalty, Payroll, PayrollFeedback, PayrollItem, Store } from "@/lib/models";
import { localMonth, prevMonth, viDate, viMonth } from "@/lib/time";
import { hoursVi, vnd } from "@/lib/format";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Textarea } from "@/components/ui";
import { submitPayrollFeedback } from "../actions";
import PayExplain from "@/components/user/PayExplain";
import { aiRemaining } from "@/lib/ai";
import { geminiConfigured } from "@/lib/ocr";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const user = await requireActiveUser();
  const store = await Store.findById(user.storeId).lean();
  const tz = store?.timezone || "Asia/Ho_Chi_Minh";
  const { month: m } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(m || "") ? m! : prevMonth(localMonth(new Date(), tz));
  const item = await PayrollItem.findOne({ userId: user._id, month }).lean();
  const payroll = item ? await Payroll.findById(item.payrollId).lean() : null;
  const visible = payroll && payroll.status !== "DRAFT";
  const bps = visible ? await BonusPenalty.find({ userId: user._id, month }).sort({ date: 1 }).lean() : [];
  const explain = await aiRemaining("payExplain", `user:${user._id}`);
  const feedbacks = item ? await PayrollFeedback.find({ payrollItemId: item._id }).sort({ createdAt: -1 }).lean() : [];

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-accent">Bảng lương</h1>
        <MonthPicker month={month} base="/payroll" />
      </div>
      {!visible || !item ? (
        <Alert tone="yellow">
          Bảng lương tháng {viMonth(month)} chưa được công bố. Bảng lương được công bố vào ngày 5 tháng sau (hoặc sớm hơn nếu admin công bố).
          <br />
          <Link href={`/history?month=${month}`} className="underline">Xem giờ công tạm tính →</Link>
        </Alert>
      ) : (
        <>
          <Card title={`Tháng ${viMonth(month)}`} actions={<Badge tone={payroll.status === "PAID" ? "green" : "yellow"}>{payroll.status === "PAID" ? "Đã thanh toán" : "Đã công bố"}</Badge>}>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt>Giờ tính công</dt><dd className="text-right">{hoursVi(item.totalHours)} h</dd>
              {!!item.supportHours && (
                <>
                  <dt className="pl-3 text-xs text-ink/70">trong đó hỗ trợ</dt>
                  <dd className="text-right text-xs text-ink/70">{item.supportNote}</dd>
                </>
              )}
              {!!item.holidayHours && (
                <>
                  <dt className="pl-3 text-xs text-danger">trong đó làm ngày lễ</dt>
                  <dd className="text-right text-xs text-danger">{item.holidayNote}</dd>
                </>
              )}
              <dt>Lương giờ</dt><dd className="text-right">{vnd(item.hourlyWage)}</dd>
              <dt>Lương cơ bản</dt><dd className="text-right">{vnd(item.basePay)}</dd>
              {!!item.holidayExtra && (
                <>
                  <dt className="pl-3 text-xs text-danger">gồm phụ trội ngày lễ</dt>
                  <dd className="text-right text-xs text-danger">+{vnd(item.holidayExtra)}</dd>
                </>
              )}
              <dt>Phụ cấp</dt><dd className="text-right">{vnd(item.allowance)}</dd>
              <dt>Thưởng</dt><dd className="text-right text-bonus">+{vnd(item.totalBonus)}</dd>
              <dt>Phạt</dt><dd className="text-right text-danger">−{vnd(item.totalPenalty)}</dd>
              <dt>Tạm ứng</dt><dd className="text-right">−{vnd(item.advance)}</dd>
              <dt className="border-t border-[#f1e6c8] pt-2 text-base font-bold">Thực nhận</dt>
              <dd className="border-t border-[#f1e6c8] pt-2 text-right text-lg font-bold text-secondary-dark">{vnd(item.netPay)}</dd>
            </dl>
            <p className="mt-2 text-xs text-ink/60">
              {item.paidAt ? "✅ Quán đã trả lương tháng này." : "Số liệu tự cập nhật theo chấm công, thưởng phạt cho tới khi quán trả lương."}
            </p>
          </Card>
          {/* AI giải thích lương – chỉ hiện khi Admin Tổng bật ở Cài đặt → AI */}
          {explain.enabled && geminiConfigured() && (
            <PayExplain month={month} netPay={vnd(item.netPay)} left={Number.isFinite(explain.left) ? explain.left : null} limit={explain.limit} />
          )}
          <Card title="Chi tiết thưởng / phạt">
            {bps.length === 0 ? (
              <p className="text-sm text-ink/60">Không có</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {bps.map((b) => (
                  <li key={String(b._id)} className="flex justify-between gap-2">
                    <span>
                      {viDate(b.date)} · {b.content}
                      {b.attendanceId && (
                        <Link href={`/history?month=${month}`} className="ml-1 text-xs text-accent underline">(xem chấm công)</Link>
                      )}
                    </span>
                    <span className={b.kind === "BONUS" ? "text-bonus" : "text-danger"}>
                      {b.kind === "BONUS" ? "+" : "−"}
                      {vnd(b.amountVnd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Phản hồi / khiếu nại">
            <ActionForm action={submitPayrollFeedback} submitLabel="Gửi phản hồi" successText="Đã gửi phản hồi tới admin">
              <input type="hidden" name="itemId" value={String(item._id)} />
              <Textarea name="content" rows={2} placeholder="VD: Khoản phạt ngày 05/11 chưa đúng vì…" />
            </ActionForm>
            {feedbacks.map((f) => (
              <div key={String(f._id)} className="mt-3 rounded-xl bg-cream p-2 text-sm">
                <p>{f.content}</p>
                {f.adminReply ? <p className="text-xs text-secondary-dark">Admin: {f.adminReply}</p> : <p className="text-xs text-ink/60">Chờ phản hồi</p>}
              </div>
            ))}
          </Card>
        </>
      )}
    </>
  );
}
