"use server";
import { revalidatePath } from "next/cache";
import { Settings } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { connectDB } from "@/lib/db";
import { AI_FEATURES, AI_MODELS, AI_ROLES, getAiConfig, type AiConfig } from "@/lib/ai";
import { errMsg, num, str, type FormState } from "./types";

/** Lưu Cài đặt AI: bật/tắt + giới hạn + model từng chức năng, ngân sách token, ngưỡng bất thường. Chỉ Admin Tổng. */
export async function saveAiSettings(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const owner = await assertOwner();
    await connectDB();
    const before = await getAiConfig();
    const models = AI_MODELS.map((m) => m.key as string);
    const features = Object.fromEntries(
      AI_FEATURES.map((f) => {
        const model = str(fd.get(`model_${f.key}`));
        const roles = Object.fromEntries(AI_ROLES.map(({ key }) => [key, f.roles.includes(key) && fd.get(`role_${f.key}_${key}`) === "on"]));
        return [f.key, { enabled: fd.get(`on_${f.key}`) === "on", limit: Math.max(0, Math.round(num(fd.get(`limit_${f.key}`), f.limit))), model: models.includes(model) ? model : "", roles }];
      }),
    ) as AiConfig["features"];
    const next: Partial<AiConfig> = {
      enabled: fd.get("enabled") === "on",
      monthlyTokens: Math.max(0, Math.round(num(fd.get("monthlyTokens"), 3_000_000))),
      warnPct: Math.min(100, Math.max(1, Math.round(num(fd.get("warnPct"), 80)))),
      features,
      anomaly: {
        negDiff: Math.max(0, Math.round(num(fd.get("an_negDiff"), 100_000))),
        negRepeat: Math.max(1, Math.round(num(fd.get("an_negRepeat"), 3))),
        ketFactor: Math.max(1, num(fd.get("an_ketFactor"), 2)),
        lateCloseMin: Math.max(10, Math.round(num(fd.get("an_lateCloseMin"), 60))),
        telegram: fd.get("an_telegram") === "on",
      },
    };
    await Settings.updateOne({ key: "main" }, { $set: { "ai.enabled": next.enabled, "ai.monthlyTokens": next.monthlyTokens, "ai.warnPct": next.warnPct, "ai.features": next.features, "ai.anomaly": next.anomaly } });
    await audit(adminActor(owner), "ai.settings", { type: "Settings", id: "ai" }, { enabled: before.enabled, monthlyTokens: before.monthlyTokens }, next);
    revalidatePath("/admin/settings/ai");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Nội dung Trợ lý cửa hàng (6 chủ đề). Chỉ Admin Tổng. */
export async function saveAssistantContent(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const owner = await assertOwner();
    await connectDB();
    const keys = ["rules", "storage", "ingredient", "closing", "attendance", "managers"] as const;
    const content = Object.fromEntries(keys.map((k) => [k, str(fd.get(k)).slice(0, 8000)]));
    await Settings.updateOne({ key: "main" }, { $set: { "ai.assistant": content } });
    await audit(adminActor(owner), "ai.assistant", { type: "Settings", id: "ai" }, null, { sections: keys.filter((k) => content[k]).length });
    revalidatePath("/admin/settings/ai");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Rà bất thường ngay (không chờ lịch hằng ngày). */
export async function runAnomalyNow(_: FormState): Promise<FormState> {
  try {
    const owner = await assertOwner();
    const { runAnomaly } = await import("@/lib/anomaly");
    await runAnomaly({ actor: `admin:${owner.accountId ?? "owner"}` });
    revalidatePath("/admin/closings/anomaly");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/** Đánh dấu / bỏ đánh dấu "đã xử lý" 1 bất thường. */
export async function resolveAnomaly(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const owner = await assertOwner();
    const { AnomalyResolved } = await import("@/lib/models");
    const key = str(fd.get("key")).slice(0, 200);
    if (!key) return { error: "Thiếu mã" };
    if (str(fd.get("undo")) === "1") await AnomalyResolved.deleteOne({ key });
    else await AnomalyResolved.updateOne({ key }, { $setOnInsert: { key, by: adminActor(owner).name } }, { upsert: true });
    revalidatePath("/admin/closings/anomaly");
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

/* ===== Dự báo → gợi ý số người / ca ===== */
export type ForecastView = {
  days: string[];
  templates: { id: string; name: string; startTime: string; current: number }[];
  cells: { date: string; tplId: string; suggest: number; current: number; rev: number | null; samples: number }[];
  holidayNames: Record<string, string>;
  explanation: string;
  weeks: number;
};

/** Gợi ý số người / ca cho tuần weekStart (admin). Số doanh thu dự báo chỉ trả về cho Admin Tổng. */
export async function getForecast(storeId: string, weekStart: string): Promise<{ data?: ForecastView; error?: string }> {
  try {
    const { assertAdmin } = await import("@/lib/guards");
    const admin = await assertAdmin();
    const { Types } = await import("mongoose");
    if (!Types.ObjectId.isValid(String(storeId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart))) return { error: "Tham số không hợp lệ" };
    const { loadForecast } = await import("@/lib/forecast");
    const f = await loadForecast(String(storeId), String(weekStart));
    if (!f.templates.length) return { error: "Cơ sở chưa có ca mẫu" };
    const owner = admin.kind === "OWNER";
    const name = (id: string) => f.templates.find((t) => t.id === id)?.name ?? "?";
    let explanation = f.weeks < 3 ? `Mới có khoảng ${f.weeks} tuần dữ liệu chốt ca – gợi ý còn thô, nên xem lại.` : "";
    try {
      const { geminiGenerate } = await import("@/lib/ocr");
      const t = await geminiGenerate({
        feature: "forecast",
        actor: `admin:${admin.accountId ?? "owner"}`,
        temperature: 0.2,
        timeoutMs: 25_000,
        prompt: `Bạn là trợ lý xếp ca của quán trà sữa Tiệm Bơ Sầu. Hệ thống đã dự báo doanh thu từng ca tuần ${weekStart} (theo trung vị cùng thứ 6 tuần gần nhất, ngày lễ nhân hệ số ${f.holidayFactor.toFixed(1)}) và gợi ý số người = doanh thu dự báo / doanh thu mỗi người của ca.
Viết 2–3 câu tiếng Việt cho admin giải thích VÌ SAO gợi ý tăng / giảm người ở đâu (so với định mức hiện tại "current"). CHỈ dựa vào dữ liệu, không bịa con số mới${owner ? "" : ", KHÔNG nêu số tiền doanh thu"}.
${JSON.stringify({ holidays: f.holidayNames, cells: f.cells.filter((c) => c.suggest !== c.current).slice(0, 30).map((c) => ({ date: c.date, shift: name(c.tplId), suggest: c.suggest, current: c.current, revenue: owner ? c.rev : undefined, samples: c.samples })) })}`,
      });
      const s = String(t ?? "").trim();
      if (s) explanation = [explanation, s.slice(0, 1200)].filter(Boolean).join(" ");
    } catch (e) {
      if (!explanation) explanation = `(Không có phần giải thích AI: ${(e as Error).message})`;
    }
    return {
      data: {
        days: f.days,
        templates: f.templates.map((t) => ({ id: t.id, name: t.name, startTime: t.startTime, current: Math.max(t.targetStaff, t.minStaff) })),
        cells: f.cells.map((c) => ({ ...c, rev: owner ? c.rev : null })),
        holidayNames: f.holidayNames,
        explanation,
        weeks: f.weeks,
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Áp dụng gợi ý làm định mức RIÊNG từng ngày của tuần đó (không đổi định mức chung, không tự xếp ai). */
export async function applyForecast(storeId: string, weekStart: string, targets: { tplId: string; date: string; target: number }[]): Promise<{ ok?: boolean; error?: string }> {
  try {
    const { assertAdmin } = await import("@/lib/guards");
    const admin = await assertAdmin();
    const { Types } = await import("mongoose");
    const { ShiftTemplate } = await import("@/lib/models");
    const { addDays } = await import("@/lib/time");
    if (!Types.ObjectId.isValid(String(storeId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(weekStart))) return { error: "Tham số không hợp lệ" };
    const days = Array.from({ length: 7 }, (_, i) => addDays(String(weekStart), i));
    const list = (Array.isArray(targets) ? targets : []).filter((t) => Types.ObjectId.isValid(String(t.tplId)) && days.includes(String(t.date)));
    const byTpl = new Map<string, { date: string; target: number }[]>();
    for (const t of list) (byTpl.get(String(t.tplId)) ?? byTpl.set(String(t.tplId), []).get(String(t.tplId))!).push({ date: String(t.date), target: Math.max(0, Math.min(20, Math.round(Number(t.target) || 0))) });
    for (const [tplId, arr] of byTpl) {
      const tpl = await ShiftTemplate.findOne({ _id: tplId, storeId }).select("staffByDate").lean();
      if (!tpl) continue;
      const keep = ((tpl.staffByDate ?? []) as { date?: string | null; target?: number | null }[]).filter((x) => x.date && !days.includes(x.date));
      await ShiftTemplate.updateOne({ _id: tplId }, { $set: { staffByDate: [...keep, ...arr] } });
    }
    await audit(adminActor(admin), "schedule.staffing", { type: "Store", id: String(storeId) }, null, { weekStart, n: list.length, source: "AI gợi ý" });
    revalidatePath(`/admin/schedule/${storeId}`);
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/* ===== Hỏi AI (admin) ===== */
export async function askDataAction(question: string): Promise<{ answer?: string; source?: string; denied?: boolean; error?: string; left?: number }> {
  try {
    const { assertAdmin } = await import("@/lib/guards");
    const admin = await assertAdmin();
    const { askData, ASK_TOOL_LABEL } = await import("@/lib/ask-ai");
    const { aiRemaining } = await import("@/lib/ai");
    const r = await askData(admin, String(question ?? ""));
    const left = await aiRemaining("ask", `admin:${admin.accountId ?? "owner"}`);
    return { answer: r.answer, source: r.tool ? ASK_TOOL_LABEL[r.tool] : undefined, denied: r.denied, left: Number.isFinite(left.left) ? left.left : undefined };
  } catch (e) {
    return { error: (e as Error).message || "AI đang bận, thử lại sau" };
  }
}
