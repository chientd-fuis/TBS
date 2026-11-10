/*
 * Cài đặt AI + kiểm soát token.
 * Mọi lần gọi Gemini có `feature` → kiểm tra bật/tắt, giới hạn lượt, ngân sách token tháng → ghi AiUsage (số token).
 * Cấu hình lưu ở Settings.ai (Mixed) – thiếu khoá nào thì dùng mặc định dưới đây.
 */
import { connectDB } from "./db";
import { AiUsage, Settings, User } from "./models";
import { DEFAULT_TZ, localDate, localMonth, zonedToDate } from "./time";
import { RULES_TEMPLATE } from "./rules-format";
import { LIMIT_QUIPS, pickQuip } from "./ai-quips";

export type LimitUnit = "month" | "day" | "dayActor" | "monthActor";
/** Role được Admin Tổng bật/tắt AI (Admin Tổng luôn dùng được mọi chức năng). */
export type AiRole = "admin" | "manager" | "staff";
export const AI_ROLES: { key: AiRole; label: string }[] = [
  { key: "admin", label: "Admin" },
  { key: "manager", label: "NV quản lý" },
  { key: "staff", label: "Nhân viên" },
];
export type AiFeatureKey =
  | "closingOcr"
  | "billOcr"
  | "attendanceOcr"
  | "reportComment"
  | "assistant"
  | "anomaly"
  | "payExplain"
  | "forecast"
  | "ask"
  | "rulesSummary";

export const AI_MODELS = [
  { key: "", label: "Mặc định (GEMINI_MODEL)" },
  { key: "gemini-2.5-flash", label: "2.5 Flash" },
  { key: "gemini-2.5-flash-lite", label: "2.5 Flash-Lite (rẻ)" },
] as const;

export const AI_FEATURES: {
  key: AiFeatureKey;
  label: string;
  hint: string;
  unit: LimitUnit;
  limit: number;
  enabled: boolean;
  model: string;
  /** vẫn chạy khi hết ngân sách tháng (chức năng chính, không được dừng) */
  essential?: boolean;
  /** các role có dùng chức năng này (Admin Tổng bật/tắt riêng từng role); [] = chỉ hệ thống / Admin Tổng */
  roles: AiRole[];
}[] = [
  { key: "closingOcr", label: "Đọc ảnh tờ chốt ca", hint: "Nhân viên / admin chụp tờ chốt ca → tự điền số", unit: "month", limit: 2000, enabled: true, model: "", essential: true, roles: ["admin", "manager", "staff"] },
  { key: "billOcr", label: "Đọc bill / sao kê", hint: "Nhập chi phí từ ảnh", unit: "month", limit: 300, enabled: true, model: "", roles: ["admin"] },
  { key: "attendanceOcr", label: "Đọc ảnh bảng chấm công", hint: "Chấm công hộ → Đọc ảnh (AI)", unit: "month", limit: 100, enabled: true, model: "", roles: ["admin"] },
  { key: "reportComment", label: "Nhận xét báo cáo tài chính", hint: "Đoạn nhận xét trong tin Telegram ngày / tuần / tháng", unit: "month", limit: 60, enabled: true, model: "", roles: [] },
  { key: "assistant", label: "Trợ lý cửa hàng (nhân viên)", hint: "Nội quy · quản lý · bảo quản · nguyên liệu · chốt ca · chấm công", unit: "dayActor", limit: 10, enabled: true, model: "", roles: ["manager", "staff"] },
  { key: "anomaly", label: "Phát hiện bất thường chốt ca & két", hint: "Rà theo từng nhân viên mỗi ngày, AI viết tóm tắt", unit: "day", limit: 3, enabled: true, model: "", roles: [] },
  { key: "payExplain", label: "Giải thích lương cho nhân viên", hint: "NV hỏi “vì sao lương tháng này là X”", unit: "monthActor", limit: 3, enabled: false, model: "", roles: ["manager", "staff"] },
  { key: "forecast", label: "Dự báo → gợi ý số người / ca", hint: "Thống kê doanh thu theo thứ / ngày lễ; AI viết lý do", unit: "month", limit: 10, enabled: true, model: "", roles: ["admin"] },
  { key: "rulesSummary", label: "Tóm tắt nội quy", hint: "Lưu nội quy đầy đủ → AI tóm tắt ~10 điều cho nút “Nội quy” của nhân viên", unit: "month", limit: 30, enabled: true, model: "", roles: [] },
  { key: "ask", label: "Trợ lý AI (admin)", hint: "Hỏi / nhờ làm bằng tiếng Việt: tra dữ liệu, thưởng phạt, chấm hộ, tạm ứng… theo quyền", unit: "dayActor", limit: 30, enabled: true, model: "", roles: ["admin"] },
];
export const UNIT_LABEL: Record<LimitUnit, string> = { month: "lượt / tháng", day: "lượt / ngày", dayActor: "câu / ngày / người", monthActor: "lượt / tháng / người" };

export type AiFeatureCfg = { enabled: boolean; limit: number; model: string; roles: Record<AiRole, boolean> };
export type AssistantContent = { rules: string; storage: string; ingredient: string; closing: string; attendance: string; managers: string };
export type AnomalyCfg = { negDiff: number; negRepeat: number; ketFactor: number; lateCloseMin: number; telegram: boolean };
export type AiConfig = {
  enabled: boolean;
  monthlyTokens: number;
  warnPct: number;
  features: Record<AiFeatureKey, AiFeatureCfg>;
  assistant: AssistantContent;
  /** nội quy tóm tắt (AI tóm tắt từ assistant.rules, admin sửa được) – hiện ở nút "Nội quy" */
  rulesSummary: string;
  anomaly: AnomalyCfg;
};

export const DEFAULT_ASSISTANT: AssistantContent = {
  rules: RULES_TEMPLATE, // mẫu 10 điều – admin sửa lại
  storage: "",
  ingredient: "",
  closing:
    "Cuối ca: mở app → Chốt ca → chụp tờ chốt ca (AI tự điền số) → kiểm tra Tiền mặt / Tài khoản / Grab / Shopee / Chi phí két → Gửi. Số chốt ca là LUỸ KẾ: ca Chiều đã gồm ca Sáng, ca Tối = cả ngày.",
  attendance:
    "Đến quán → mở app → bấm CHECK-IN (chụp khuôn mặt, bật vị trí / dùng WiFi quán theo cài đặt cơ sở). Về: bấm CHECK-OUT. Quên check-in / check-out: Lịch sử → Gửi yêu cầu điều chỉnh (nhập giờ + lý do), admin duyệt. Đổi ca / nhờ làm hộ: Lịch ca → Đổi ca / Nhờ làm hộ.",
  managers: "",
};
export const DEFAULT_ANOMALY: AnomalyCfg = { negDiff: 100_000, negRepeat: 3, ketFactor: 2, lateCloseMin: 60, telegram: true };

/** Ghép cấu hình đã lưu với mặc định (hàm thuần – có test). */
export function mergeAiConfig(raw: unknown): AiConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<AiConfig> & { features?: Partial<Record<AiFeatureKey, Partial<AiFeatureCfg>>> };
  const features = Object.fromEntries(
    AI_FEATURES.map((f) => {
      const v: Partial<AiFeatureCfg> = r.features?.[f.key] ?? {};
      const rv = (v.roles ?? {}) as Partial<Record<AiRole, boolean>>;
      // role không dùng chức năng này → false; role có dùng → mặc định bật
      const roles = Object.fromEntries(AI_ROLES.map(({ key }) => [key, f.roles.includes(key) && rv[key] !== false])) as Record<AiRole, boolean>;
      return [f.key, { enabled: typeof v.enabled === "boolean" ? v.enabled : f.enabled, limit: Number.isFinite(v.limit) ? Math.max(0, Number(v.limit)) : f.limit, model: typeof v.model === "string" ? v.model : f.model, roles }];
    }),
  ) as Record<AiFeatureKey, AiFeatureCfg>;
  return {
    enabled: r.enabled !== false,
    monthlyTokens: Number.isFinite(r.monthlyTokens) ? Math.max(0, Number(r.monthlyTokens)) : 3_000_000,
    warnPct: Number.isFinite(r.warnPct) ? Number(r.warnPct) : 80,
    features,
    assistant: {
      ...DEFAULT_ASSISTANT,
      ...(r.assistant ?? {}),
      // nội quy trống → dùng mẫu 10 điều (nút “Nội quy” không bao giờ trống)
      rules: String(r.assistant?.rules ?? "").trim() ? String(r.assistant!.rules) : DEFAULT_ASSISTANT.rules,
    },
    rulesSummary: typeof r.rulesSummary === "string" ? r.rulesSummary : "",
    anomaly: { ...DEFAULT_ANOMALY, ...(r.anomaly ?? {}) },
  };
}

/** Nội quy hiện cho nhân viên: bản tóm tắt; chưa có thì dùng bản đầy đủ. */
export const rulesShown = (cfg: AiConfig) => (cfg.rulesSummary.trim() ? cfg.rulesSummary : cfg.assistant.rules);

export async function getAiConfig(): Promise<AiConfig> {
  await connectDB();
  const s = await Settings.findOne({ key: "main" }).select("ai").lean();
  return mergeAiConfig(s?.ai);
}

/** Đầu tháng / đầu ngày theo giờ VN. */
function periodStart(kind: "day" | "month", now = new Date()) {
  const d = kind === "day" ? localDate(now, DEFAULT_TZ) : `${localMonth(now, DEFAULT_TZ)}-01`;
  return zonedToDate(d, "00:00", DEFAULT_TZ);
}

export async function monthTokens(now = new Date()) {
  const r = await AiUsage.aggregate<{ t: number }>([{ $match: { createdAt: { $gte: periodStart("month", now) } } }, { $group: { _id: null, t: { $sum: "$tokens" } } }]);
  return r[0]?.t ?? 0;
}

export class AiLimitError extends Error {}

/** Role của người gọi: "admin:owner" = Admin Tổng; "admin:<id>" = Admin; "user:<id>" = nhân viên (có quyền quản lý → NV quản lý); còn lại = hệ thống. */
export type ActorRole = AiRole | "owner" | "system";
export const userAiRole = (u: { managerPerms?: string[] | null }): AiRole => (u.managerPerms?.length ? "manager" : "staff");
export async function actorRole(actor: string): Promise<ActorRole> {
  if (actor === "admin:owner") return "owner";
  if (actor.startsWith("admin:")) return "admin";
  if (actor.startsWith("user:")) {
    const id = actor.slice(5);
    const u = /^[a-f\d]{24}$/i.test(id) ? await User.findById(id).select("managerPerms").lean() : null;
    return userAiRole(u ?? {});
  }
  return "system";
}
/** Admin Tổng đã cho role này dùng chức năng chưa (hàm thuần). */
export const roleAllowed = (cfg: AiConfig, feature: AiFeatureKey, role: ActorRole) => role === "owner" || role === "system" || cfg.features[feature].roles[role];
const roleName = (r: AiRole) => AI_ROLES.find((x) => x.key === r)!.label;

/** Kiểm tra trước khi gọi AI: bật/tắt, ngân sách token tháng, giới hạn lượt. Ném AiLimitError (câu dễ hiểu) nếu không được. */
export async function aiGuard(feature: AiFeatureKey, actor = "system") {
  const cfg = await getAiConfig();
  const meta = AI_FEATURES.find((f) => f.key === feature)!;
  const fc = cfg.features[feature];
  if (!cfg.enabled && !meta.essential) throw new AiLimitError("Chức năng AI đang tắt (Cài đặt → AI)");
  if (!fc.enabled) throw new AiLimitError(`Admin chưa bật chức năng “${meta.label}”`);
  const role = await actorRole(actor);
  if (!roleAllowed(cfg, feature, role)) throw new AiLimitError(`Admin Tổng chưa cho ${roleName(role as AiRole)} dùng “${meta.label}”`);
  if (cfg.monthlyTokens > 0 && !meta.essential && (await monthTokens()) >= cfg.monthlyTokens)
    throw new AiLimitError("Đã dùng hết ngân sách AI của tháng – thử lại tháng sau hoặc nhờ Admin Tổng tăng ngân sách");
  if (fc.limit > 0) {
    const byDay = meta.unit === "day" || meta.unit === "dayActor";
    const q: Record<string, unknown> = { feature, ok: true, createdAt: { $gte: periodStart(byDay ? "day" : "month") } };
    if (meta.unit === "dayActor" || meta.unit === "monthActor") q.actor = actor;
    const used = await AiUsage.countDocuments(q);
    if (used >= fc.limit)
      // khung chat (Hỏi AI / Trợ lý) hết lượt → câu đùa; chức năng khác giữ câu giải thích rõ ràng
      throw new AiLimitError(feature === "ask" || feature === "assistant" ? pickQuip(LIMIT_QUIPS) : `Đã dùng hết ${fc.limit} ${UNIT_LABEL[meta.unit]} cho “${meta.label}”${byDay ? " – thử lại ngày mai" : " – thử lại tháng sau"}`);
  }
  return { cfg, model: fc.model };
}

/** Có hiện nút AI cho người này không (bật toàn hệ thống / chức năng / role). Chức năng "essential" vẫn chạy khi tắt AI toàn hệ thống. */
export async function aiAllowed(feature: AiFeatureKey, actor: string) {
  const cfg = await getAiConfig();
  const meta = AI_FEATURES.find((f) => f.key === feature)!;
  return (cfg.enabled || !!meta.essential) && cfg.features[feature].enabled && roleAllowed(cfg, feature, await actorRole(actor));
}

/** Số lượt còn lại (hiện cho người dùng, VD "còn 9/10 câu hôm nay"). */
export async function aiRemaining(feature: AiFeatureKey, actor: string) {
  const cfg = await getAiConfig();
  const meta = AI_FEATURES.find((f) => f.key === feature)!;
  const fc = cfg.features[feature];
  const byDay = meta.unit === "day" || meta.unit === "dayActor";
  const q: Record<string, unknown> = { feature, ok: true, createdAt: { $gte: periodStart(byDay ? "day" : "month") } };
  if (meta.unit === "dayActor" || meta.unit === "monthActor") q.actor = actor;
  const used = await AiUsage.countDocuments(q);
  const allowed = roleAllowed(cfg, feature, await actorRole(actor));
  return { enabled: cfg.enabled && fc.enabled && allowed, limit: fc.limit, left: fc.limit > 0 ? Math.max(0, fc.limit - used) : Infinity, byDay };
}

export async function recordAiUsage(feature: AiFeatureKey, actor: string, tokens: number, model: string, ok = true) {
  await AiUsage.create({ feature, actor, tokens: Math.max(0, Math.round(tokens || 0)), model, ok }).catch(() => null);
}

/** Thống kê cho trang Cài đặt AI: lượt + token tháng này theo chức năng. */
export async function aiUsageStats(now = new Date()) {
  const rows = await AiUsage.aggregate<{ _id: string; n: number; t: number }>([
    { $match: { createdAt: { $gte: periodStart("month", now) } } },
    // n = số lượt (không tính lần gọi phụ), t = tổng token (cả lần gọi phụ)
    { $group: { _id: "$feature", n: { $sum: { $cond: ["$ok", 1, 0] } }, t: { $sum: "$tokens" } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, { n: r.n, t: r.t }])) as Record<string, { n: number; t: number }>;
}
