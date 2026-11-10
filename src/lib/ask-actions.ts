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
import { addDays, localMonth, nextMonth, prevMonth, viDate } from "./time";
import { evalCalc } from "./calc-expr";
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
  /** phép tính ra số tiền (VD "31 × 5000") – server tự tính, không tin số AI cộng nhân */
  calc?: string | null;
};
type Ctx = { stores: { id: string; name: string }[]; today: string };
type Person = { id: string; name: string };

export type AskProposal =
  | { type: "set_wage"; userId: string; name: string; hourlyWage: number; effectiveFrom: string }
  | { type: "bonus_penalty"; kind: "BONUS" | "PENALTY"; amount: number; content: string; date: string; people: Person[] }
  | { type: "payroll_extra"; field: "advance" | "allowance"; amount: number; month: string; userId: string; name: string; itemId: string; note?: string }
  | { type: "manual_attendance"; userId: string; name: string; date: string; inTime: string; outTime: string; reason: string };
/** Phiếu xác nhận hiện cho admin: tiêu đề + các dòng mô tả + dữ liệu để thực hiện. */
export type AskCard = { title: string; lines: string[]; proposal: AskProposal };

/** Nhân viên gợi ý khi tên không khớp chắc chắn – admin bấm chọn */
export type PersonChoice = { id: string; name: string; store: string };
/** Cần admin chọn đúng người cho tên `forName` */
export type PickNeeded = { choices: PersonChoice[]; forName: string; message: string };
type PlanOut = AskCard | { error: string } | PickNeeded;
type WriteTool = { key: string; desc: string; allowed: (a: AdminSession) => boolean; plan: (a: ActArgs, ctx: Ctx, find: Finder) => Promise<PlanOut> };
/** dò 1 nhân viên theo tên (dùng chung với công cụ tra cứu). Tên dạng "#id:<id>" = admin đã bấm chọn. */
export type Finder = (name: string | null | undefined, storeIds: string[]) => Promise<{ person?: Person; choices?: PersonChoice[]; error?: string }>;

/**
 * Số tiền: có phép tính → server tự tính; không thì lấy số AI đưa.
 * Lấy trị tuyệt đối: cộng / trừ do `kind` quyết định – AI hay ghi tạm ứng / phạt thành số âm ("trừ vào lương").
 */
export function amountOf(a: ActArgs): { amount: number; calcLine?: string } {
  const c = String(a.calc ?? "").trim().replace(/^[-−–]\s*/, "");
  const v = c ? evalCalc(c) : null;
  if (v != null && v > 0) return { amount: v, calcLine: /[×x*/÷:+\-%]/.test(c) ? `Cách tính: ${c} = ${vnd(v)}` : undefined };
  return { amount: Math.abs(money(a.amount)) };
}
/**
 * Số tiền ghi trong câu hỏi ("300k", "300000", "1tr2", "300.000đ") – dùng khi AI bỏ trống amount.
 * Bỏ qua số nhỏ không đơn vị (tháng 10, ngày 15) và năm (2026). Có 2 số tiền khác nhau → null (không đoán).
 */
export function moneyInText(text: string): number | null {
  const found = new Set<number>();
  // đơn vị phải đứng riêng ("10 Đức" không phải 10đ)
  for (const m of text.matchAll(/(\d+(?:[.,]\d+)*)\s*(tr(?:iệu)?\s*\d{0,3}|k|nghìn|ngàn|đồng|đ|₫|vnd)?(?![\p{L}\d])/giu)) {
    const unit = (m[2] ?? "").toLowerCase();
    if (!unit && (/^(19|20)\d{2}$/.test(m[1]) || /^\d{1,2}[.,]\d{1,2}$/.test(m[1]))) continue;
    const v = evalCalc(m[1] + (/^(đ|₫|vnd|đồng)$/.test(unit) ? "" : unit));
    if (v != null && (unit || v >= 1000)) found.add(v);
  }
  return found.size === 1 ? [...found][0] : null;
}
/** Phép nhân ghi bằng lời: "ship 31 đơn, mỗi đơn hỗ trợ 5k" → "31 × 5k" (null nếu không có). */
export function calcInText(text: string): string | null {
  const m = /(\d+)\s*(đơn|ly|cốc|lần|ca|ngày|buổi|giờ)(?![\p{L}])[^\d]*?mỗi\s*(?:\2)?[^\d]{0,30}?(\d+(?:[.,]\d+)*\s*(?:k|nghìn|ngàn|tr(?:iệu)?\s*\d{0,3}|đồng|đ)?)(?![\p{L}\d])/iu.exec(text);
  if (!m) return null;
  const expr = `${m[1]} × ${m[3].replace(/\s*(đồng|đ)$/i, "").trim()}`;
  return (evalCalc(expr) ?? 0) > 0 ? expr : null;
}
/**
 * Tháng ghi trong câu ("tháng 10", "tháng 10/2025", "T10") → "YYYY-MM". Không ghi năm: tháng lớn hơn tháng hiện tại = năm trước
 * (tháng 1 nói "tháng 12" là tháng 12 năm ngoái) – trừ khi preferPast = false (VD lương mới "từ tháng 12"). today = "YYYY-MM-DD".
 */
export function monthInText(text: string, today: string, preferPast = true): string | null {
  if (/tháng\s*(này|nay)(?![\p{L}])/iu.test(text)) return today.slice(0, 7);
  if (/tháng\s*trước(?![\p{L}])/iu.test(text)) return prevMonth(today.slice(0, 7));
  if (/tháng\s*(sau|tới)(?![\p{L}])/iu.test(text)) return nextMonth(today.slice(0, 7));
  const m = /(?<![\p{L}])(?:tháng|t)\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{4}))?(?![\p{L}\d])/iu.exec(text);
  if (!m) return null;
  const mm = Number(m[1]);
  if (mm < 1 || mm > 12) return null;
  const y = m[2] ? Number(m[2]) : Number(today.slice(0, 4)) - (preferPast && mm > Number(today.slice(5, 7)) ? 1 : 0);
  return `${y}-${String(mm).padStart(2, "0")}`;
}
/**
 * Ngày ghi trong câu: "30/10", "30/10/2025", "hôm nay" / "sáng nay"…, "hôm qua" → "YYYY-MM-DD".
 * "30/10" không ghi năm mà sau hôm nay → năm trước. Không có → null.
 */
export function dateInText(text: string, today: string): string | null {
  const m = /(?<![\d/])(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{4}))?(?![\d/])/.exec(text);
  if (m) {
    const [d, mo] = [Number(m[1]), Number(m[2])];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    const md = `${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const y = m[3] ? Number(m[3]) : Number(today.slice(0, 4)) - (md > today.slice(5) ? 1 : 0);
    return `${y}-${md}`;
  }
  if (/hôm\s*qua(?![\p{L}])/iu.test(text)) return addDays(today, -1);
  if (/(?<![\p{L}])nay(?![\p{L}])/iu.test(text)) return today; // hôm nay, sáng nay, ca tối nay…
  return null;
}
/** Phụ cấp hay tạm ứng theo từ trong câu; có cả hai / không có → null (để AI quyết). */
export function extraKindInText(text: string): "allowance" | "advance" | null {
  const allow = /phụ\s*cấp|trợ\s*cấp|hỗ\s*trợ/iu.test(text);
  const adv = /(?<![\p{L}])ứng(?![\p{L}])/iu.test(text);
  return allow === adv ? null : allow ? "allowance" : "advance";
}
/** Các giờ ghi trong câu theo thứ tự ("8h", "8h30", "8:30", "8 giờ") → ["08:00", "17:30"]. */
export function timesInText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(\d{1,2})\s*(?:h|giờ|:)\s*(\d{2})?(?![\p{L}\d])/giu)) {
    const h = Number(m[1]);
    const mi = Number(m[2] ?? 0);
    if (h < 24 && mi < 60) out.push(`${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`);
  }
  return out;
}
/** Đổi tên admin đã chọn ("forName") thành "#id:<id>" trong tham số (person / people). */
export function applyPick(a: ActArgs, forName: string, userId: string): ActArgs {
  const tag = `#id:${userId}`;
  const same = (x?: string | null) => String(x ?? "").trim().toLowerCase() === forName.trim().toLowerCase();
  return {
    ...a,
    person: same(a.person) ? tag : a.person,
    people: a.people?.map((x) => (same(x) ? tag : x)),
    ...(!same(a.person) && !a.people?.some(same) ? { person: tag } : {}),
  };
}

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
async function one(a: ActArgs, ctx: Ctx, find: Finder): Promise<{ person: Person } | { error: string } | PickNeeded> {
  const name = a.person ?? a.people?.[0];
  const r = await find(name, ctx.stores.map((s) => s.id));
  if (r.person) return { person: r.person };
  if (r.choices?.length) return { choices: r.choices, forName: String(name ?? ""), message: r.error ?? "Bạn chọn đúng nhân viên:" };
  return { error: r.error ?? "Không tìm thấy nhân viên" };
}

export const WRITE_TOOLS: WriteTool[] = [
  {
    key: "set_wage",
    desc: "ĐỔI lương giờ của 1 nhân viên (args: person, amount = lương giờ mới, SỐ đồng/giờ – '23k/h' = 23000, date = ngày hiệu lực – 'từ tháng 11' = ngày 01 tháng đó, mặc định hôm nay). Cần quyền Bảng lương",
    allowed: (a) => can(a, "payroll"),
    plan: async (a, ctx, find) => {
      const r = await one(a, ctx, find);
      if (!("person" in r)) return r;
      const wage = amountOf(a).amount;
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
    desc: "THÊM khoản thưởng hoặc phạt cho 1 hoặc nhiều nhân viên (args: kind = BONUS | PENALTY, amount = số tiền MỖI người, calc = phép tính nếu có, content = lý do, people = danh sách tên, hoặc everyone = true + store?, date = ngày ghi trong câu – '30/10' = YYYY-10-30)",
    allowed: () => true,
    plan: async (a, ctx, find) => {
      const kind = String(a.kind ?? "").toUpperCase().startsWith("B") || /thưởng/i.test(String(a.kind)) ? "BONUS" : "PENALTY";
      const { amount, calcLine } = amountOf(a);
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
          if (!r.person && r.choices?.length) return { choices: r.choices, forName: n, message: r.error ?? `Chọn đúng nhân viên cho "${n}":` };
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
          ...(calcLine ? [calcLine] : []),
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
    desc: "CỘNG THÊM tiền tạm ứng (kind = advance, trừ vào lương) hoặc phụ cấp / trợ cấp / hỗ trợ (kind = allowance, cộng vào lương – VD hỗ trợ ship X đơn × Y đ) cho 1 nhân viên vào bảng lương 1 tháng (args: person, kind, amount = số DƯƠNG kể cả tạm ứng, calc = phép tính nếu có VD '31 × 5000', content = ghi chú ngắn VD 'Hỗ trợ ship 31 đơn × 5k', month = tháng ghi trong câu – 'tháng 10' = YYYY-10, câu KHÔNG ghi tháng mới dùng tháng này). Cần quyền Bảng lương",
    allowed: (a) => can(a, "payroll"),
    plan: async (a, ctx, find) => {
      const r = await one(a, ctx, find);
      if (!("person" in r)) return r;
      const field = /allow|phụ|trợ|hỗ/i.test(String(a.kind)) ? "allowance" : "advance";
      const { amount, calcLine } = amountOf(a);
      const note = String(a.content ?? "").trim().slice(0, 200);
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
        lines: [
          `Nhân viên: ${r.person.name} · tháng ${mm}`,
          ...(calcLine ? [calcLine] : []),
          ...(note ? [`Ghi chú: ${note}`] : []),
          `${label}: ${vnd(cur)} → ${vnd(cur + amount)} (cộng ${vnd(amount)})`,
          `Thực nhận: ${vnd(item.netPay)} → ${vnd(net)}`,
        ],
        proposal: { type: "payroll_extra", field, amount, month, userId: r.person.id, name: r.person.name, itemId: String(item._id), note: note || undefined },
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
