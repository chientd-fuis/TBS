import { requireOwner } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { ReportLog, Store } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { geminiConfigured } from "@/lib/ocr";
import { telegramConfigured } from "@/lib/telegram";
import { addDays, localDate, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, Select } from "@/components/ui";
import { saveFinanceSettings, sendReportNow, testFinanceTelegram } from "../../../actions/finance";

export const dynamic = "force-dynamic";

export default async function FinanceSettingsPage() {
  await requireOwner();
  await connectDB();
  const s = await getSettings();
  const stores = await Store.find().sort({ createdAt: 1 }).lean();
  const logs = await ReportLog.find().sort({ sentAt: -1 }).limit(8).lean();
  const yesterday = addDays(localDate(new Date()), -1);
  const chk = (name: string, on: boolean | undefined, label: string, hint: string) => (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={on !== false} className="mt-1" />
      <span>
        {label}
        <span className="block text-xs text-ink/60">{hint}</span>
      </span>
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Nhóm Telegram & báo cáo">
        {!telegramConfigured() && <Alert tone="orange">Chưa cấu hình TELEGRAM_BOT_TOKEN.</Alert>}
        {!geminiConfigured() && <Alert tone="yellow">Chưa có GEMINI_API_KEY – không đọc bill tự động, báo cáo không có phần nhận xét AI.</Alert>}
        <ActionForm action={saveFinanceSettings} variant="secondary">
          <Field label="Chat ID nhóm Quản lý doanh thu" hint="Thêm bot vào nhóm → lấy chat ID (dạng -100…) như nhóm chốt ca. Trống → dùng env TELEGRAM_FINANCE_CHAT_ID">
            <Input name="financeChatId" defaultValue={s.financeChatId ?? ""} placeholder="-1001234567890" />
          </Field>
          {chk("financeReportDaily", s.financeReportDaily, "Báo cáo ngày", "Gửi ngay khi cơ sở cuối cùng chốt ca Tối; nếu có cơ sở chưa chốt → gửi lúc ~1h sáng hôm sau")}
          {chk("financeReportWeekly", s.financeReportWeekly, "Báo cáo tuần", "~1h sáng thứ 2, cho tuần trước (T2–CN)")}
          {chk("financeReportMonthly", s.financeReportMonthly, "Báo cáo tháng", "~1h sáng ngày 1, cho tháng trước")}
          {chk("financeAiComment", s.financeAiComment, "Nhận xét bằng AI (Gemini)", "2–4 dòng nhận xét cuối báo cáo, chỉ dựa trên số liệu thật")}
          <div className="mt-2">
            <p className="mb-1 text-xs font-semibold text-accent">% phí sàn (trừ vào doanh thu khi tính lãi)</p>
            <div className="space-y-2">
              {stores.map((st) => (
                <div key={String(st._id)} className="grid grid-cols-[1fr_5.5rem_5.5rem] items-end gap-2">
                  <span className="pb-2 text-sm">{st.name}</span>
                  <Field label="Grab %"><Input name={`grab_${st._id}`} inputMode="decimal" defaultValue={st.grabFeePct ?? 0} /></Field>
                  <Field label="Shopee %"><Input name={`shopee_${st._id}`} inputMode="decimal" defaultValue={st.shopeeFeePct ?? 0} /></Field>
                </div>
              ))}
            </div>
          </div>
        </ActionForm>
        <div className="mt-3 border-t border-[#f1e6c8] pt-3">
          <ActionForm action={testFinanceTelegram} submitLabel="Gửi tin thử vào nhóm" variant="outline" successText="Đã gửi – kiểm tra nhóm Telegram" />
        </div>
      </Card>

      <Card title="Gửi báo cáo ngay">
        <ActionForm action={sendReportNow} submitLabel="Gửi" variant="secondary" successText="Đã gửi vào nhóm">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Loại">
              <Select name="kind" defaultValue="daily">
                <option value="daily">Báo cáo ngày</option>
                <option value="weekly">Báo cáo tuần (chứa ngày chọn)</option>
                <option value="monthly">Báo cáo tháng (chứa ngày chọn)</option>
              </Select>
            </Field>
            <Field label="Ngày"><Input type="date" name="date" defaultValue={yesterday} /></Field>
          </div>
        </ActionForm>
        <p className="mt-4 mb-1 text-xs font-semibold text-accent">Đã gửi gần đây</p>
        {logs.length ? (
          <ul className="space-y-1 text-sm">
            {logs.map((l) => (
              <li key={String(l._id)} className="flex items-center gap-2">
                <span className="flex-1">{l.key}</span>
                <span className="text-xs text-ink/60">{viDateTime(l.sentAt)}</span>
                <Badge tone={l.status === "SENT" ? "green" : "red"}>{l.status === "SENT" ? "Đã gửi" : "Lỗi"}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink/50">Chưa gửi báo cáo nào.</p>
        )}
      </Card>
    </div>
  );
}
