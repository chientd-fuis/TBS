import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { AiUsage, AssistantLog, User } from "@/lib/models";
import { AI_FEATURES, AI_MODELS, AI_ROLES, UNIT_LABEL, aiUsageStats, getAiConfig, monthTokens } from "@/lib/ai";
import { geminiKeys, geminiModels } from "@/lib/ocr";
import { freeUsageToday, keyTag, nextResetVi } from "@/lib/ai-free";
import { storeManagers } from "@/lib/assistant";
import { viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Field, Input, PageTitle, Select, Textarea } from "@/components/ui";
import { regenRulesSummary, saveAiSettings, saveAssistantContent, saveFreeLimits, saveRulesSummary } from "../../../actions/ai";
import RulesView from "@/components/RulesView";

export const dynamic = "force-dynamic";

const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2).replace(".", ",")} triệu` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const FEATURE_LABEL = Object.fromEntries(AI_FEATURES.map((f) => [f.key, f.label]));

/** Cài đặt AI (Admin Tổng): bật/tắt + giới hạn từng chức năng, ngân sách token, nội dung Trợ lý cửa hàng, ngưỡng bất thường. */
export default async function AiSettingsPage() {
  await requireOwner();
  const [cfg, used, stats, recent, missing, managers, free] = await Promise.all([
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
    freeUsageToday(),
  ]);
  // gói miễn phí: key (project) × model, theo ngày giờ Mỹ
  const keyList = geminiKeys().map((k, i) => ({ tag: keyTag(k), label: `Key ${i + 1}` }));
  const models = [...new Set([...geminiModels(), ...free.map((f) => f.model)])];
  const freeRows = keyList.flatMap((k) =>
    models.map((m) => ({ ...(free.find((f) => f.keyTag === k.tag && f.model === m) ?? { used: 0, errors: 0, tokens: 0, lastMin: 0, blockedToday: false }), key: k.label, model: m })),
  );
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

      <Card title={`Gói miễn phí Gemini hôm nay · reset ${nextResetVi()}`}>
        <p className="mb-2 text-xs text-ink/60">
          Google tính lượt miễn phí theo <b>từng key (project) × từng model × ngày giờ Mỹ</b> (reset 0h Pacific). Mỗi lần gọi đều tính 1 lượt – kể cả lần thử lại, chuyển model dự phòng, lỗi; chỉ lần bị từ chối vì hết lượt là không tính.
          Hạn mức free Google đổi liên tục → mở <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="underline">AI Studio</a> (mục Usage / Rate limits của từng project) chép số “RPD” của từng model vào ô bên dưới.
        </p>
        <div className="overflow-x-auto">
          <table className="tbs text-sm">
            <thead>
              <tr><th>Key</th><th>Model</th><th className="text-right">Đã gọi</th><th className="text-right">Còn free</th><th className="text-right">1 phút qua</th><th className="text-right">Token</th><th></th></tr>
            </thead>
            <tbody>
              {freeRows.map((r) => {
                const lim = cfg.freeRpd[r.model] ?? 0;
                const left = lim ? Math.max(0, lim - r.used) : null;
                return (
                  <tr key={`${r.key}|${r.model}`} className={r.used || r.blockedToday ? "" : "text-ink/50"}>
                    <td>{r.key}</td>
                    <td className="text-xs">{r.model}</td>
                    <td className="text-right tabular-nums">{r.used}{lim ? ` / ${lim}` : ""}{r.errors ? <span className="block text-[11px] text-warn">{r.errors} lần lỗi</span> : null}</td>
                    <td className="text-right font-semibold tabular-nums">{r.blockedToday ? <span className="text-danger">hết</span> : left == null ? <span className="font-normal text-ink/40">?</span> : <span className={left <= Math.ceil(lim * 0.1) ? "text-danger" : "text-secondary-dark"}>{left}</span>}</td>
                    <td className="text-right tabular-nums">{r.lastMin}</td>
                    <td className="text-right tabular-nums">{fmt(r.tokens)}</td>
                    <td className="text-xs">{r.blockedToday && <Badge tone="red">Google báo hết lượt ngày</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ActionForm action={saveFreeLimits} submitLabel="Lưu hạn mức" successText="Đã lưu" variant="outline" className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-3">
            {models.map((m) => (
              <Field key={m} label={`${m} – lượt free / ngày`}>
                <Input name={`rpd_${m}`} defaultValue={cfg.freeRpd[m] || ""} inputMode="numeric" placeholder="theo AI Studio" className="!w-36 text-right" />
              </Field>
            ))}
          </div>
        </ActionForm>
        <p className="mt-2 text-[11px] text-ink/50">
          Số ở đây đếm từ lúc cập nhật bản này, chỉ gồm lượt app gọi (key dùng chung chỗ khác thì AI Studio sẽ cao hơn). “Token / tháng” ở trên là ngân sách app tự đặt để kiểm soát chi phí, không phải hạn mức free của Google.
        </p>
      </Card>

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
                <tr><th>Chức năng</th><th className="text-center">Bật</th><th>Cho phép dùng<div className="text-[10px] font-normal">(Admin Tổng luôn dùng được)</div></th><th>Model</th><th>Giới hạn (0 = không giới hạn)</th><th className="text-right">Tháng này</th></tr>
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
                      <td className="whitespace-nowrap text-xs">
                        {f.roles.length ? (
                          <div className="flex flex-col gap-1">
                            {AI_ROLES.filter((r) => f.roles.includes(r.key)).map((r) => (
                              <label key={r.key} className="flex items-center gap-1.5">
                                <input type="checkbox" name={`role_${f.key}_${r.key}`} defaultChecked={c.roles[r.key]} className="h-4 w-4 accent-[#3c9c54]" /> {r.label}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <span className="text-ink/50">Tự động (hệ thống / Admin Tổng)</span>
                        )}
                      </td>
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
          <div className="rounded-xl bg-cream p-3">
            <p className="text-sm font-semibold text-accent">🌧️ Dự báo thời tiết &amp; gợi ý giảm ca</p>
            <p className="mb-2 text-xs text-ink/60">
              Open-Meteo (miễn phí, không tốn token AI) · mưa &gt; 60% hoặc nhiệt độ TB ngày &lt; 22°C → nên giảm ca; mức giảm học từ doanh thu chốt ca + thời tiết thực tế 4 tuần gần nhất (chưa đủ ≥ 3 ngày mưa / lạnh thì dùng mức mặc định −20% / −35%).
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {(
                [
                  ["wx_overview", cfg.weather.overview, "Tổng quan", "cảnh báo ca nên giảm người các ngày còn lại trong tuần"],
                  ["wx_schedule", cfg.weather.schedule, "Xếp ca", "dải thời tiết tuần + gợi ý số người tính theo thời tiết"],
                  ["wx_workSchedule", cfg.weather.workSchedule, "Lịch làm việc", "thời tiết trên đầu từng ngày"],
                ] as const
              ).map(([name, on, label, hint]) => (
                <label key={name} className="flex items-start gap-2">
                  <input type="checkbox" name={name} defaultChecked={on} className="mt-0.5 h-4 w-4 accent-[#3c9c54]" />
                  <span>
                    <b>{label}</b> <span className="text-xs text-ink/60">– {hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </ActionForm>
      </Card>

      <Card title="Trợ lý cửa hàng – nội dung nhân viên được hỏi">
        <p className="mb-3 text-xs text-ink/70">
          Trợ lý <b>chỉ</b> trả lời các chủ đề dưới đây (+ “Cách nhận hàng / tồn kho” và hướng dẫn chụp tờ chốt ca có sẵn trong app), dựa đúng nội dung bạn nhập. Câu ngoài phạm vi → từ chối; câu chưa có nội dung → “chưa có trong nội quy, hỏi quản lý”. Trợ lý không xem được chấm công, lương, doanh thu của ai.
        </p>
        <ActionForm action={saveAssistantContent} submitLabel="Lưu nội dung trợ lý" successText="Đã lưu" className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <Field label="📋 Nội quy, quy định (bản đầy đủ)" hint="Trợ lý dùng bản này để trả lời. Lưu → AI tự tóm tắt ~10 điều cho nút “Nội quy” của nhân viên (xem ở thẻ bên dưới). Định dạng: # tiêu đề · 1. điều mục · - ý nhỏ · **đậm** · ! lưu ý">
              <Textarea name="rules" rows={14} defaultValue={cfg.assistant.rules} className="font-mono text-xs" />
            </Field>
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

      <Card title="📖 Nội quy tóm tắt – nhân viên thấy ở nút “Nội quy”">
        <p className="mb-3 text-xs text-ink/70">
          AI tự tóm tắt mỗi khi bạn lưu nội quy đầy đủ (có thay đổi). Nhân viên thấy badge <b className="text-danger">NEW</b> khi bản này đổi.{" "}
          {cfg.rulesSummary.trim() ? "" : <b>Chưa có bản tóm tắt – nhân viên đang xem bản đầy đủ.</b>}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl bg-cream p-3">
            <p className="mb-2 text-xs font-semibold text-accent">👁 Nhân viên đang thấy</p>
            <RulesView text={cfg.rulesSummary.trim() ? cfg.rulesSummary : cfg.assistant.rules} />
          </div>
          <div className="space-y-3">
            <ActionForm action={regenRulesSummary} submitLabel="✨ AI tóm tắt lại từ bản đầy đủ" variant="outline" successText="Đã tóm tắt lại" />
            <ActionForm action={saveRulesSummary} submitLabel="Lưu bản tóm tắt" successText="Đã lưu" className="space-y-2">
              <Field label="Sửa tay bản tóm tắt" hint="Để trống = nhân viên xem bản đầy đủ. Lưu nội quy đầy đủ lần sau sẽ bị AI tóm tắt đè lên.">
                <Textarea name="rulesSummary" rows={14} defaultValue={cfg.rulesSummary} className="font-mono text-xs" />
              </Field>
            </ActionForm>
          </div>
        </div>
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
