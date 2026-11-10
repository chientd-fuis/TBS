/*
 * Hỏi AI (admin) – HÀNH ĐỘNG sửa dữ liệu.
 * AI chỉ ĐỀ XUẤT (chọn hành động + tham số) → server dò nhân viên, kiểm tra, dựng "phiếu xác nhận".
 * Không ghi gì cho tới khi admin bấm "Xác nhận" → executeAskProposal (actions/ai.ts) gọi lại đúng server action
 * của màn hình tương ứng (cùng kiểm tra quyền, khoá bảng lương, nhật ký).
 */
import { Types } from "mongoose";
import { Payroll, PayrollItem, User } from "./models";
import { can } from "./permissions";
import { generatePayroll } from "./payroll";
import { localMonth, viDate } from "./time";
import type { AdminSession } from "./admin-session";

export type ActArgs = {
  person?: string | null;
  people?: string[] | null;
  everyone?: boolean | null;
  store?: string | null;
  kind?: string | null;
  amount?: number | null;
  content?: string | null;
  date?: string | null;
  month?: string | null;
  inTime?: string | null;
  outTime?: string | null;
};
type Ctx = { stores: { id: string; name: string }[]; today: string };
type Person = { id: string; name: string };

export type AskProposal =
  | { type: "set_wage"; userId: string; name: string; hourlyWage: number; effectiveFrom: string }
  | { type: "bonus_penalty"; kind: "BONUS" | "PENALTY"; amount: number; content: string; date: string; people: Person[] }
  | { type: "payroll_extra"; field: "advance" | "allowance"; amount: number; month: string; userId: string; name: string; itemId: string }
  | { type: "manual_attendance"; userId: string; name: string; date: string; inTime: string; outTime: string; reason: string };
/** Phiếu xác nhận hiện cho admin: tiêu đề + các dòng mô tả + dữ liệu để thực hiện. */
export type AskCard = { title: string; lines: string[]; proposal: AskProposal };

type PlanOut = AskCard | { error: string } | { ambiguous: string[] };
type WriteTool = { key: string; desc: string; allowed: (a: AdminSession) => boolean; plan: (a: ActArgs, ctx: Ctx, find: Finder) => Promise<PlanOut> };
/** dò 1 nhân viên theo tên (dùng chung với công cụ tra cứu) */
export type Finder = (name: string | null | undefined, storeIds: string[]) => Promise<{ person?: Person; ambiguous?: string[]; error?: string }>;

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")} ₫`;
const isDate = (d?: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isMonth = (m?: string | null) => !!m && /^\d{4}-\d{2}$/.test(m);
const hhmm = (t?: string | null) => {
  const m = /^(\d{1,2})[:hH.]?(\d{2})?/.exec(String(t ?? "").trim());
  if (!m) return "";
  const h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}` : "";
};
const money = (n: unknown) => Math.round(Number(n) || 0);
const storeIds = (a: ActArgs, ctx: Ctx) => {
  if (!a.store) return ctx.stores.map((s) => s.id);
  const k = a.store.toLowerCase();
  const hit = ctx.stores.filter((s, i) => s.name.toLowerCase().includes(k) || k.includes(s.name.toLowerCase().replace(/^tbs\s*/, "")) || `cs${i + 1}` === k.replace(/\s+/g, ""));
  return (hit.length ? hit : ctx.stores).map((s) => s.id);
};
async function one(a: ActArgs, ctx: Ctx, find: Finder): Promise<{ person: Person } | { error: string } | { ambiguous: string[] }> {
  const r = await find(a.person ?? a.people?.[0], ctx.stores.map((s) => s.id));
  if (r.ambiguous) return { ambiguous: r.ambiguous };
  if (!r.person) return { error: r.error ?? "Không tìm thấy nhân viên" };
  return { person: r.person };
}

export const WRITE_TOOLS: WriteTool[] = [
  {
    key: "set_wage",
    desc: "ĐỔI lương giờ của 1 nhân viên (args: person, amount = lương giờ mới ₫/giờ, date = ngày hiệu lực, mặc định hôm nay). Cần quyền Bảng lương",
    allowed: (a) => can(a, "payroll"),
    plan: async (a, ctx, find) => {
      const r = await one(a, ctx, find);
      if (!("person" in r)) return r;
      const wage = money(a.amount);
      if (wage < 1000 || wage > 2_000_000) return { error: "Lương giờ không hợp lệ – hỏi lại kèm số tiền mỗi giờ (VD 25.000)" };
      const u = await User.findById(r.person.id).select("hourlyWage").lean();
      const from = isDate(a.date) ? a.date! : ctx.today;
      return {
        title: "Đổi lương giờ",
        lines: [`Nhân viên: ${r.person.name}`, `Lương giờ: ${vnd(u?.hourlyWage ?? 0)} → ${vnd(wage)} / giờ`, `Hiệu lực từ: ${viDate(from)}`],
        proposal: { type: "set_wage", userId: r.person.id, name: r.person.name, hourlyWage: wage, effectiveFrom: from },
      };
    },
  },
  {
    key: "bonus_penalty",
    desc: "THÊM khoản thưởng hoặc phạt cho 1 hoặc nhiều nhân viên (args: kind = BONUS | PENALTY, amount = số tiền MỖI người, content = lý do, people = danh sách tên, hoặc everyone = true + store?, date = ngày áp dụng, mặc định hôm nay)",
    allowed: () => true,
    plan: async (a, ctx, find) => {
      const kind = String(a.kind ?? "").toUpperCase().startsWith("B") || /thưởng/i.test(String(a.kind)) ? "BONUS" : "PENALTY";
      const amount = money(a.amount);
      if (amount <= 0 || amount > 100_000_000) return { error: "Thiếu số tiền thưởng / phạt" };
      const content = String(a.content ?? "").trim();
      if (content.length < 3) return { error: "Thiếu lý do thưởng / phạt – hỏi lại kèm lý do" };
      let people: Person[] = [];
      if (a.everyone) {
        const ids = storeIds(a, ctx).map((i) => new Types.ObjectId(i));
        people = (await User.find({ status: "ACTIVE", storeId: { $in: ids } }).select("name").sort({ name: 1 }).lean()).map((u) => ({ id: String(u._id), name: u.name || "?" }));
      } else {
        const names = [...(a.people ?? []), ...(a.person ? [a.person] : [])].map((x) => String(x).trim()).filter(Boolean);
        if (!names.length) return { error: "Chưa rõ thưởng / phạt cho ai" };
        const missing: string[] = [];
        for (const n of [...new Set(names)]) {
          const r = await find(n, ctx.stores.map((s) => s.id));
          if (r.ambiguous) return { error: `"${n}" trùng nhiều người: ${r.ambiguous.join(", ")} – hỏi lại kèm họ tên đầy đủ` };
          if (r.person) {
            if (!people.some((p) => p.id === r.person!.id)) people.push(r.person);
          } else missing.push(n);
        }
        if (missing.length) return { error: `Không tìm thấy nhân viên: ${missing.join(", ")}` };
      }
      if (!people.length) return { error: "Không có nhân viên nào" };
      if (people.length > 60) return { error: "Tối đa 60 người / lần" };
      const date = isDate(a.date) ? a.date! : ctx.today;
      const label = kind === "BONUS" ? "Thưởng" : "Phạt";
      return {
        title: `${label} ${people.length} nhân viên`,
        lines: [
          `${label}: ${vnd(amount)}${people.length > 1 ? " / người" : ""}${people.length > 1 ? ` (tổng ${vnd(amount * people.length)})` : ""}`,
          `Lý do: ${content}`,
          `Ngày áp dụng: ${viDate(date)}`,
          `Nhân viên: ${people.map((p) => p.name).join(", ")}`,
        ],
        proposal: { type: "bonus_penalty", kind, amount, content: content.slice(0, 300), date, people },
      };
    },
  },
  {
    key: "payroll_extra",
    desc: "CỘNG THÊM tiền tạm ứng (kind = advance, trừ vào lương) hoặc phụ cấp / trợ cấp (kind = allowance, cộng vào lương) cho 1 nhân viên vào bảng lương 1 tháng (args: person, kind, amount, month mặc định tháng này). Cần quyền Bảng lương",
    allowed: (a) => can(a, "payroll"),
    plan: async (a, ctx, find) => {
      const r = await one(a, ctx, find);
      if (!("person" in r)) return r;
      const field = /allow|phụ|trợ/i.test(String(a.kind)) ? "allowance" : "advance";
      const amount = money(a.amount);
      if (amount <= 0 || amount > 100_000_000) return { error: "Thiếu số tiền" };
      const month = isMonth(a.month) ? a.month! : localMonth(new Date());
      const mm = `${month.slice(5)}/${month.slice(0, 4)}`;
      if (month > localMonth(new Date())) return { error: `Tháng ${mm} chưa tới` };
      let items = await PayrollItem.find({ userId: r.person.id, month }).lean();
      if (!items.length) {
        // bảng lương luôn tính sẵn: chưa có thì tạo ngay ở cơ sở gốc của nhân viên
        const u = await User.findById(r.person.id).select("storeId").lean();
        if (u?.storeId) await generatePayroll(String(u.storeId), month);
        items = await PayrollItem.find({ userId: r.person.id, month }).lean();
      }
      const payrolls = await Payroll.find({ _id: { $in: items.map((i) => i.payrollId) } }).select("status").lean();
      const item = items.find((i) => !i.paidAt && payrolls.find((p) => String(p._id) === String(i.payrollId))?.status !== "PAID");
      if (!items.length) return { error: `Không có bảng lương tháng ${mm} của ${r.person.name}` };
      if (!item) return { error: `Đã trả lương tháng ${mm} cho ${r.person.name} – mở khoá ở Bảng lương (nhập lý do) trước khi sửa` };
      const cur = field === "advance" ? item.advance : item.allowance;
      const label = field === "advance" ? "Tạm ứng" : "Phụ cấp / trợ cấp";
      const net = item.netPay + (field === "advance" ? -amount : amount);
      return {
        title: `Thêm ${label.toLowerCase()} vào bảng lương`,
        lines: [`Nhân viên: ${r.person.name} · tháng ${mm}`, `${label}: ${vnd(cur)} → ${vnd(cur + amount)} (cộng ${vnd(amount)})`, `Thực nhận: ${vnd(item.netPay)} → ${vnd(net)}`],
        proposal: { type: "payroll_extra", field, amount, month, userId: r.person.id, name: r.person.name, itemId: String(item._id) },
      };
    },
  },
  {
    key: "manual_attendance",
    desc: "CHẤM CÔNG HỘ 1 lượt cho 1 nhân viên (args: person, date mặc định hôm nay, inTime = giờ vào HH:mm, outTime = giờ ra HH:mm hoặc null nếu nhân viên còn đang trong ca, content = lý do)",
    allowed: () => true,
    plan: async (a, ctx, find) => {
      const r = await one(a, ctx, find);
      if (!("person" in r)) return r;
      const inTime = hhmm(a.inTime);
      if (!inTime) return { error: "Thiếu giờ vào – hỏi lại kèm giờ vào (VD 8h)" };
      const outTime = hhmm(a.outTime);
      const date = isDate(a.date) ? a.date! : ctx.today;
      const reason = String(a.content ?? "").trim() || "Nhân viên chấm công lỗi, nhờ admin chấm hộ";
      return {
        title: "Chấm công hộ",
        lines: [
          `Nhân viên: ${r.person.name}`,
          `Ngày: ${viDate(date)}`,
          `Giờ vào: ${inTime}`,
          `Giờ ra: ${outTime || "chưa có – nhân viên đang trong ca, tự bấm CHECK-OUT khi về"}`,
          ...(outTime ? ["(Giờ ra chưa tới thì chỉ ghi check-in, nhân viên tự check-out khi về)"] : []),
          `Lý do: ${reason}`,
        ],
        proposal: { type: "manual_attendance", userId: r.person.id, name: r.person.name, date, inTime, outTime, reason: reason.slice(0, 300) },
      };
    },
  },
];
