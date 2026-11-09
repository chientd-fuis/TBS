import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { AiUsage, AssistantLog, User } from "@/lib/models";
import { AI_FEATURES, AI_MODELS, UNIT_LABEL, aiUsageStats, getAiConfig, monthTokens } from "@/lib/ai";
import { geminiKeys } from "@/lib/ocr";
import { storeManagers } from "@/lib/assistant";
import { viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Input, PageTitle, Select, Textarea } from "@/components/ui";
import { saveAiSettings, saveAssistantContent } from "../../../actions/ai";

export const dynamic = "force-dynamic";

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(".", ",")} triệu` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const FEATURE_LABEL = Object.fromEntries(AI_FEATURES.map((f) => [f.key, f.label]));

/** Cài đặt AI (Admin Tổng): bật/tắt + giới hạn từng chức năng, ngân sách token, nội dung Trợ lý cửa hàng, ngưỡng bất thường. */
export default async function AiSettingsPage() {
  await requireOwner();
  const [cfg, used, stats, recent, missing, managers] = await Promise.all([
    getAiConfig(),
    monthTokens(),
    aiUsageStats(),
    AiUsage.find().sort({ createdAt: -1 }).limit(15).lean(),
    AssistantLog.aggregate<{ _id: string; n: number; status: string }>([
      { $match: { status: { $in: ["MISSING", "OUT_OF_SCOPE"] }, createdAt: { $gte: new Date(Date.now() - 14 * 86_400_000) } } },
      { $group: { _id: { $toLower: "$question" }, n: { $sum: 1 }, status: { $last: "$status" } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]),
    storeManagers(),
  ]);
  const pct = cfg.monthlyTokens ? Math.min(100, Math.round((used / cfg.monthlyTokens) * 100)) : 0;
  const userIds = recent.filter((r) => r.actor?.startsWith("user:")).map((r) => r.actor!.slice(5));
  const names = new Map((await User.find({ _id: { $in: userIds } }).select("name").lean()).map((u) => [`user:${u._id}`, u.name]));
  const who = (a?: string | null) => (!a || a === "system" ? "Hệ thống" : a === "admin:owner" ? "Admin Tổng" : a.startsWith("admin:") ? "Admin" : (names.get(a) ?? "Nhân viên"));
  const keys = geminiKeys().length;

  return (
    <>
      <PageTitle sub="Bật / tắt từng chức năng AI và đặt giới hạn để kiểm soát token (chi phí Gemini). Hết giới hạn → chức năng tạm dừng tới kỳ sau, báo rõ cho người dùng.">
        <Link href="/admin/settings" className="text-sm font-normal underline">Cài đặt</Link> / AI
      </PageTitle>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-ink/60">Token dùng tháng này</p>
          <p className="text-2xl font-bold">{fmt(used)}</p>
          <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#f3ecdc]">
            <div className={`h-full rounded-full ${pct >= cfg.warnPct ? "bg-danger" : "bg-secondary"}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs text-ink/60">{cfg.monthlyTokens ? `${pct}% ngân sách ${fmt(cfg.monthlyTokens)} token/tháng` : "Không giới hạn ngân sách"}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink/60">API key Gemini</p>
          <p className="text-2xl font-bold">{keys} key</p>
          <p className="mt-1 text-xs text-ink/60">{keys > 1 ? "Tự chuyển key khi 1 key hết lượt miễn phí" : keys ? "Thêm GEMINI_API_KEY_2… để có thêm lượt miễn phí" : "Chưa cấu hình GEMINI_API_KEY"}</p>
        </Card>
        <Card>
          <p className="text-xs text-ink/60">Trạng thái</p>
          <p className="text-2xl font-bold">{cfg.enabled ? <span className="text-secondary-dark">Đang bật</span> : <span className="text-danger">Đang tắt</span>}</p>
          <p className="mt-1 text-xs text-ink/60">Hết ngân sách / tắt AI: vẫn giữ “Đọc ảnh tờ chốt ca” để nhân viên chốt ca được.</p>
        </Card>
      </div>

      <Card title="Chức năng & giới hạn">
        <ActionForm action={saveAiSettings} submitLabel="Lưu cài đặt AI" successText="Đã lưu" className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="enabled" defaultChecked={cfg.enabled} className="h-4 w-4 accent-[#3c9c54]" /> Bật AI toàn hệ thống
            </label>
            <Field label="Ngân sách token / tháng (0 = không giới hạn)"><Input name="monthlyTokens" defaultValue={cfg.monthlyTokens} inputMode="numeric" className="!w-40 text-right" /></Field>
            <Field label="Tô đỏ khi dùng tới (%)"><Input name="warnPct" defaultValue={cfg.warnPct} inputMode="numeric" className="!w-24 text-right" /></Field>
          </div>
          <div className="overflow-x-auto">
            <table className="tbs text-sm">
              <thead>
                <tr><th>Chức năng</th><th className="text-center">Bật</th><th>Model</th><th>Giới hạn (0 = không giới hạn)</th><th className="text-right">Tháng này</th></tr>
              </thead>
              <tbody>
                {AI_FEATURES.map((f) => {
                  const c = cfg.features[f.key];
                  const st = stats[f.key];
                  return (
                    <tr key={f.key}>
                      <td>
                        <b>{f.label}</b>
                        <div className="text-xs text-ink/60">{f.hint}</div>
                      </td>
                      <td className="text-center"><input type="checkbox" name={`on_${f.key}`} defaultChecked={c.enabled} className="h-4 w-4 accent-[#3c9c54]" aria-label={`Bật ${f.label}`} /></td>
                      <td>
                        <Select name={`model_${f.key}`} defaultValue={c.model} className="!w-44 !py-1">
                          {AI_MODELS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                        </Select>
                      </td>
                      <td className="whitespace-nowrap">
                        <Input name={`limit_${f.key}`} defaultValue={c.limit} inputMode="numeric" className="!w-20 !py-1 text-right" /> <span className="text-xs text-ink/60">{UNIT_LABEL[f.unit]}</span>
                      </td>
                      <td className="text-right text-xs tabular-nums">{st ? `${st.n} lượt · ${fmt(st.t)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl bg-cream p-3">
            <p className="mb-2 text-sm font-semibold text-accent">Ngưỡng “Phát hiện bất thường chốt ca &amp; két”</p>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Âm tiền ≥ (₫ / ca)"><Input name="an_negDiff" defaultValue={cfg.anomaly.negDiff} inputMode="numeric" className="!w-32 text-right" /></Field>
              <Field label="Âm lặp lại ≥ (lần / 7 ngày)"><Input name="an_negRepeat" defaultValue={cfg.anomaly.negRepeat} inputMode="numeric" className="!w-24 text-right" /></Field>
              <Field label="Chi phí két ≥ (× TB 4 tuần)"><Input name="an_ketFactor" defaultValue={cfg.anomaly.ketFactor} className="!w-24 text-right" /></Field>
              <Field label="Chốt ca lệch giờ ra ca ≥ (phút)"><Input name="an_lateCloseMin" defaultValue={cfg.anomaly.lateCloseMin} inputMode="numeric" className="!w-24 text-right" /></Field>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="an_telegram" defaultChecked={cfg.anomaly.telegram} className="h-4 w-4 accent-[#3c9c54]" /> Gửi Telegram nhóm quản lý doanh thu
              </label>
            </div>
          </div>
        </ActionForm>
      </Card>

      <Card title="Trợ lý cửa hàng – nội dung nhân viên được hỏi">
        <p className="mb-3 text-xs text-ink/70">
          Trợ lý <b>chỉ</b> trả lời 6 chủ đề dưới đây, dựa đúng nội dung bạn nhập. Câu ngoài phạm vi → từ chối; câu chưa có nội dung → “chưa có trong nội quy, hỏi quản lý”. Trợ lý không xem được chấm công, lương, doanh thu của ai.
        </p>
        <ActionForm action={saveAssistantContent} submitLabel="Lưu nội dung trợ lý" successText="Đã lưu" className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="📋 Nội quy, quy định"><Textarea name="rules" rows={6} defaultValue={cfg.assistant.rules} placeholder="VD: Đến trước giờ ca 5 phút… Đi muộn quá 5 phút phạt 20.000 ₫…" /></Field>
            <Field label="👤 Ai là quản lý (bổ sung SĐT, ghi chú)" hint="Danh sách quản lý tự lấy từ admin & nhân viên được cấp quyền (bên dưới) – ghi thêm SĐT / ca phụ trách ở đây">
              <Textarea name="managers" rows={6} defaultValue={cfg.assistant.managers} placeholder="VD: Văn Phú – chị Hà 09xx xxx 123 (quản lý ca tối)" />
            </Field>
            <Field label="🧊 Quy trình bảo quản"><Textarea name="storage" rows={6} defaultValue={cfg.assistant.storage} placeholder="VD: Sầu riêng đã bóc: hộp kín, ngăn mát 2–4°C, dùng trong 24h…" /></Field>
            <Field label="⚠️ Khi nguyên liệu có vấn đề"><Textarea name="ingredient" rows={6} defaultValue={cfg.assistant.ingredient} placeholder="VD: 1. Ngừng dùng ngay… 2. Chụp ảnh… 3. Báo quản lý ca…" /></Field>
            <Field label="🧾 Hướng dẫn chốt ca"><Textarea name="closing" rows={5} defaultValue={cfg.assistant.closing} /></Field>
            <Field label="⏰ Hướng dẫn chấm công"><Textarea name="attendance" rows={5} defaultValue={cfg.assistant.attendance} /></Field>
          </div>
          <div className="rounded-xl bg-cream p-3 text-xs">
            <b>Quản lý tự động:</b>{" "}
            {managers.length ? managers.map((m) => `${m.store}: ${m.names.join(", ")}`).join(" · ") : "chưa có (cấp quyền quản lý cho nhân viên ở trang Nhân viên)"}
          </div>
        </ActionForm>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Trợ lý chưa trả lời được (14 ngày)">
          {!missing.length ? (
            <p className="text-sm text-ink/60">Chưa có</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {missing.map((m) => (
                <li key={m._id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">{m._id}</span>
                  <Badge tone={m.status === "MISSING" ? "orange" : "gray"}>{m.status === "MISSING" ? "Chưa có nội dung" : "Ngoài phạm vi"}</Badge>
                  <span className="text-xs tabular-nums text-ink/60">×{m.n}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-ink/60">Bổ sung nội dung tương ứng để nhân viên hỏi được.</p>
        </Card>
        <Card title="Lượt gọi AI gần đây">
          <table className="tbs text-sm">
            <thead><tr><th>Lúc</th><th>Chức năng</th><th>Ai dùng</th><th className="text-right">Token</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={String(r._id)}>
                  <td className="whitespace-nowrap text-xs">{viDateTime(r.createdAt)}</td>
                  <td>{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                  <td className="text-xs">{who(r.actor)}</td>
                  <td className="text-right tabular-nums">{(r.tokens ?? 0).toLocaleString("vi-VN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
