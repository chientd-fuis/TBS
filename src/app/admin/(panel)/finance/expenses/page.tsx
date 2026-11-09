import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { Expense, Store } from "@/lib/models";
import { CATEGORY_LABEL, defaultCountInCost, EXPENSE_CATEGORIES, isCountedExpense } from "@/lib/finance";
import { geminiConfigured } from "@/lib/ocr";
import { financeChatId } from "@/lib/finance-report";
import { localDate, localMonth, viDate } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { ActionForm } from "@/components/ActionForm";
import { AutoFilterForm } from "@/components/AutoFilterForm";
import { Alert, Badge, Card, Empty, Select } from "@/components/ui";
import { deleteExpense } from "../../../actions/finance";
import ExpenseForm, { type ExpenseInitial } from "./ExpenseForm";
import StatementImport from "./StatementImport";

export const dynamic = "force-dynamic";
const vnd = (n: number) => n.toLocaleString("vi-VN");
const TG = { SENT: ["Đã gửi", "green"], FAILED: ["Lỗi", "red"], PENDING: ["Đang gửi", "yellow"], DISABLED: ["Chưa cấu hình", "gray"] } as const;

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; store?: string; cat?: string; edit?: string }> }) {
  await requirePerm("finance.bills");
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : localMonth(new Date());
  const today = localDate(new Date());
  const stores = await Store.find({ active: { $ne: false } }).sort({ createdAt: 1 }).lean();
  const storeOpts = stores.map((s) => ({ id: String(s._id), name: s.name }));
  const storeName = new Map(storeOpts.map((s) => [s.id, s.name.replace(/^TBS\s*/i, "")]));
  const q: Record<string, unknown> = { month };
  if (sp.store === "SHARED") q.scope = "SHARED";
  else if (sp.store) q.storeId = sp.store;
  if (sp.cat) q.category = sp.cat;
  const list = await Expense.find(q).sort({ date: -1, createdAt: -1 }).lean();
  const counted = list.filter(isCountedExpense);
  const total = counted.reduce((s, e) => s + e.amount, 0);
  const byCat = Object.entries(
    counted.reduce<Record<string, number>>((m, e) => ((m[e.category] = (m[e.category] ?? 0) + e.amount), m), {}),
  ).sort((a, b) => b[1] - a[1]);

  const edit = sp.edit ? await Expense.findById(sp.edit).lean().catch(() => null) : null;
  const blank: ExpenseInitial = {
    date: today,
    amount: "",
    category: "NGUYEN_LIEU",
    vendor: "",
    items: "",
    transferNote: "",
    kind: "BILL",
    note: "",
    scope: "STORE",
    storeId: storeOpts.length === 1 ? storeOpts[0].id : "",
    allocation: "REVENUE",
    shares: {},
    paidFrom: "OWNER",
    countInCost: true,
  };
  const initial: ExpenseInitial = edit
    ? {
        id: String(edit._id),
        date: edit.date,
        amount: String(edit.amount),
        category: edit.category,
        vendor: edit.vendor ?? "",
        items: edit.items ?? "",
        transferNote: edit.transferNote ?? "",
        kind: edit.kind === "TRANSFER" ? "TRANSFER" : "BILL",
        note: edit.note ?? "",
        scope: edit.scope === "SHARED" ? "SHARED" : "STORE",
        storeId: edit.storeId ? String(edit.storeId) : "",
        allocation: edit.allocation ?? "REVENUE",
        shares: Object.fromEntries((edit.customShares ?? []).map((c: { storeId?: unknown; pct?: number | null }) => [String(c.storeId), String(c.pct ?? "")])),
        paidFrom: edit.paidFrom === "CASHBOX" ? "CASHBOX" : "OWNER",
        countInCost: typeof edit.countInCost === "boolean" ? edit.countInCost : defaultCountInCost(edit.category),
      }
    : blank;
  const chat = await financeChatId();

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <div className="space-y-3">
        {!chat && <Alert tone="orange">Chưa có <b>chat ID nhóm Quản lý doanh thu</b> – vào tab Cài đặt (Admin Tổng) hoặc đặt env TELEGRAM_FINANCE_CHAT_ID.</Alert>}
        {edit ? (
          <Card title="Sửa khoản chi" actions={<Link href={`/admin/finance/expenses?month=${month}`} className="text-sm text-accent underline">Huỷ sửa</Link>}>
            <ExpenseForm key={String(edit._id)} stores={storeOpts} today={today} initial={initial} />
          </Card>
        ) : (
          <Card title="Nhập chi phí từ sao kê / biên lai CK">
            <StatementImport stores={storeOpts} today={today} ocrEnabled={geminiConfigured()} />
          </Card>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker month={month} base="/admin/finance/expenses" params={{ cat: sp.cat }} />
            <AutoFilterForm className="flex flex-wrap gap-2">
              <input type="hidden" name="month" value={month} />
              <Select name="cat" defaultValue={sp.cat ?? ""} className="w-auto">
                <option value="">Tất cả danh mục</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </Select>
            </AutoFilterForm>
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-sm text-ink/70">Tổng chi tính vào chi phí: <b className="text-lg text-accent">{vnd(total)} đ</b></p>
            <p className="text-xs text-ink/60">{list.length} khoản</p>
          </div>
          {byCat.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {byCat.map(([k, v]) => (
                <li key={k} className="grid grid-cols-[8rem_1fr_6.5rem] items-center gap-2 text-xs">
                  <span className="truncate">{CATEGORY_LABEL[k] ?? k}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-gray-100"><span className="block h-full rounded-full bg-secondary" style={{ width: `${(v / total) * 100}%` }} /></span>
                  <span className="text-right tabular-nums">{vnd(v)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Danh sách chi phí">
          {!list.length ? (
            <Empty>Chưa có chi phí nào trong tháng này.</Empty>
          ) : (
            <ul className="divide-y divide-[#f1e6c8]">
              {list.map((e) => {
                const tg = TG[(e.telegram?.status ?? "PENDING") as keyof typeof TG];
                return (
                  <li key={String(e._id)} className={`flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5 text-sm ${isCountedExpense(e) ? "" : "opacity-60"}`}>
                    <div className="w-20 shrink-0 text-xs text-ink/60">{viDate(e.date).slice(0, 5)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {vnd(e.amount)} đ <span className="font-normal text-ink/60">· {CATEGORY_LABEL[e.category] ?? e.category}</span>
                      </p>
                      <p className="truncate text-xs text-ink/70">{[e.items, e.vendor, e.transferNote && `CK: ${e.transferNote}`, e.note].filter(Boolean).join(" · ") || "—"}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.scope === "STORE" && e.storeId && <Badge tone="yellow">Gắn riêng: {storeName.get(String(e.storeId)) ?? "?"}</Badge>}
                        {e.paidFrom === "CASHBOX" && <Badge tone="gray">Tiền két – không cộng</Badge>}
                        {e.paidFrom !== "CASHBOX" && !isCountedExpense(e) && <Badge tone="orange">Không tính chi phí</Badge>}
                        {e.kind === "TRANSFER" && <Badge tone="gray">Chuyển khoản</Badge>}
                        <Badge tone={tg[1]}>TG: {tg[0]}</Badge>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link href={`/admin/finance/expenses?month=${month}&edit=${e._id}`} className="text-xs text-accent underline">Sửa</Link>
                      <ActionForm action={deleteExpense} submitLabel="Xoá" variant="ghost" successText="" className="flex" confirm={`Xoá khoản chi ${vnd(e.amount)} đ ngày ${viDate(e.date)}?`}>
                        <input type="hidden" name="id" value={String(e._id)} />
                      </ActionForm>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
