/*
 * Phát hiện bất thường chốt ca & két (theo từng nhân viên).
 * Số liệu do hệ thống tính theo quy tắc (hàm thuần detectAnomalies – có test); AI chỉ viết đoạn tóm tắt.
 * Chốt ca là LUỸ KẾ → tách số riêng từng ca bằng shiftDeltas.
 */
import { connectDB } from "./db";
import { AnomalyResolved, AnomalyRun, ReportLog, ShiftClosing, Store } from "./models";
import { closingSum, shiftDeltas, type Revenue } from "./revenue";
import { addDays, DEFAULT_TZ, localDate, zonedToDate } from "./time";
import { getAiConfig, type AnomalyCfg } from "./ai";
import { geminiGenerate } from "./ocr";
import { financeChatId } from "./finance-report";
import { sendTelegramText, telegramConfigured } from "./telegram";

export type Sev = 3 | 2 | 1; // 3 nghiêm trọng · 2 cần xem · 1 lưu ý
export const SEV_LABEL: Record<Sev, string> = { 3: "Nghiêm trọng", 2: "Cần xem", 1: "Lưu ý" };

export type ClosingLite = {
  id: string;
  storeId: string;
  workDate: string;
  shiftName?: string | null;
  shiftEnd?: string | null;
  createdAt: Date;
  staff: string; // tên nhân viên chốt
  revenue: Partial<Revenue>;
  staffTotal?: number | null;
};
export type AnomalyItem = {
  key: string;
  type: "SHORT" | "KET" | "WRONG_TOTAL" | "LATE_CLOSE" | "NO_DT";
  sev: Sev;
  label: string;
  staff: string;
  storeId: string;
  workDate: string;
  shiftName: string;
  closingId: string;
  detail: string;
  amount?: number;
};
export type StaffStat = { staff: string; storeId: string; closings: number; shortCount: number; shortSum: number; wrongTotal: number };

const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Hàm thuần: closings = các lượt chốt trong kỳ (mọi ca, mọi cơ sở); history = lượt chốt 28 ngày TRƯỚC kỳ (tính trung bình két).
 */
export function detectAnomalies(closings: ClosingLite[], history: ClosingLite[], cfg: AnomalyCfg, tz = DEFAULT_TZ) {
  const items: AnomalyItem[] = [];
  const stats = new Map<string, StaffStat>();
  const stat = (c: ClosingLite) => {
    const k = `${c.staff}|${c.storeId}`;
    if (!stats.has(k)) stats.set(k, { staff: c.staff, storeId: c.storeId, closings: 0, shortCount: 0, shortSum: 0, wrongTotal: 0 });
    return stats.get(k)!;
  };
  // số riêng từng ca (bỏ phần luỹ kế ca trước)
  const own = (list: ClosingLite[]) => {
    const g = new Map<string, ClosingLite[]>();
    for (const c of list) (g.get(`${c.storeId}|${c.workDate}`) ?? g.set(`${c.storeId}|${c.workDate}`, []).get(`${c.storeId}|${c.workDate}`)!).push(c);
    const out: { c: ClosingLite; own: Revenue; hasDt: boolean; last: boolean }[] = [];
    for (const arr of g.values()) {
      const d = shiftDeltas(arr.map((c) => ({ ...c, revenue: c.revenue })));
      d.forEach((x, i) => {
        const prevDtOk = i === 0 || d[i - 1].closing.revenue.dt != null;
        out.push({ c: x.closing, own: x.own, hasDt: x.closing.revenue.dt != null && prevDtOk, last: i === d.length - 1 });
      });
    }
    return out;
  };
  const cur = own(closings);
  // trung bình chi phí két / ca theo cơ sở (28 ngày trước)
  const avgKet = new Map<string, number>();
  const ketBy = new Map<string, number[]>();
  for (const x of own(history)) (ketBy.get(x.c.storeId) ?? ketBy.set(x.c.storeId, []).get(x.c.storeId)!).push(Math.max(0, x.own.cp));
  for (const [sid, v] of ketBy) if (v.length >= 5) avgKet.set(sid, v.reduce((a, b) => a + b, 0) / v.length);
  const base = (c: ClosingLite) => ({ staff: c.staff, storeId: c.storeId, workDate: c.workDate, shiftName: c.shiftName ?? "", closingId: c.id });

  for (const { c, own: o, hasDt, last } of cur) {
    const s = stat(c);
    s.closings++;
    // 1) thiếu tiền: DT máy − DT thật của riêng ca
    if (hasDt) {
      const diff = o.dt - closingSum(o);
      if (diff >= cfg.negDiff) {
        s.shortCount++;
        s.shortSum += diff;
        items.push({ key: `SHORT:${c.id}`, type: "SHORT", sev: 2, label: "Thiếu tiền", detail: `Thiếu ${vnd(diff)} ₫ (DT máy ${vnd(o.dt)} – thực thu ${vnd(closingSum(o))})`, amount: diff, ...base(c) });
      }
    } else if (last && c.revenue.dt == null) {
      items.push({ key: `NO_DT:${c.id}`, type: "NO_DT", sev: 1, label: "Thiếu DT máy", detail: "Chưa nhập doanh thu máy → không tính được âm / dương", ...base(c) });
    }
    // 2) chi phí két bất thường
    const avg = avgKet.get(c.storeId);
    if (avg && o.cp >= 100_000 && o.cp >= cfg.ketFactor * avg) {
      const x = o.cp / avg;
      items.push({ key: `KET:${c.id}`, type: "KET", sev: x >= cfg.ketFactor * 2 ? 3 : 2, label: "Chi phí két bất thường", detail: `Két chi ${vnd(o.cp)} ₫ (gấp ${x.toFixed(1).replace(".", ",")} lần TB ${vnd(avg)} ₫/ca)`, amount: o.cp, ...base(c) });
    }
    // 3) nhân viên tự cộng sai tổng
    if (c.staffTotal != null && c.staffTotal !== closingSum(c.revenue)) {
      s.wrongTotal++;
      items.push({ key: `WRONG_TOTAL:${c.id}`, type: "WRONG_TOTAL", sev: 1, label: "Cộng sai tổng", detail: `NV ghi ${vnd(c.staffTotal)}, đúng ${vnd(closingSum(c.revenue))} (lệch ${vnd(Math.abs(c.staffTotal - closingSum(c.revenue)))})`, ...base(c) });
    }
    // 4) giờ chốt ca lệch giờ kết thúc ca
    if (c.shiftEnd) {
      let end = zonedToDate(c.workDate, c.shiftEnd, tz).getTime();
      if (c.shiftEnd < "08:00") end += 86_400_000; // ca qua đêm
      const min = Math.round((c.createdAt.getTime() - end) / 60_000);
      if (Math.abs(min) >= cfg.lateCloseMin)
        items.push({ key: `LATE_CLOSE:${c.id}`, type: "LATE_CLOSE", sev: 2, label: min > 0 ? "Chốt ca trễ" : "Chốt ca sớm", detail: `Chốt ${min > 0 ? "sau" : "trước"} giờ hết ca ${Math.floor(Math.abs(min) / 60)}h${String(Math.abs(min) % 60).padStart(2, "0")} (hết ca ${c.shiftEnd})`, ...base(c) });
    }
  }
  // lặp lại → nâng mức
  for (const s of stats.values()) {
    for (const it of items) {
      if (it.staff !== s.staff || it.storeId !== s.storeId) continue;
      if (it.type === "SHORT" && s.shortCount >= cfg.negRepeat) {
        it.sev = 3;
        it.label = "Thiếu tiền lặp lại";
        it.detail += ` · lần thứ ${s.shortCount} trong kỳ`;
      }
      if (it.type === "WRONG_TOTAL" && s.wrongTotal >= 3) it.sev = 2;
    }
  }
  items.sort((a, b) => b.sev - a.sev || b.workDate.localeCompare(a.workDate));
  const byStaff = [...stats.values()].filter((s) => s.shortCount || s.wrongTotal).sort((a, b) => b.shortSum - a.shortSum || b.wrongTotal - a.wrongTotal);
  return { items, byStaff };
}

/** Rà kỳ [from, to] (mặc định 7 ngày tới hôm qua), lưu AnomalyRun, AI viết tóm tắt. */
export async function runAnomaly(opts: { days?: number; actor?: string } = {}) {
  await connectDB();
  const cfg = await getAiConfig();
  const today = localDate(new Date());
  const to = addDays(today, -1);
  const from = addDays(to, -((opts.days ?? 7) - 1));
  const stores = await Store.find({ active: { $ne: false } }).select("name timezone").lean();
  const name = new Map(stores.map((s) => [String(s._id), s.name]));
  const load = async (a: string, b: string) =>
    (
      await ShiftClosing.find({ workDate: { $gte: a, $lte: b }, storeId: { $in: stores.map((s) => s._id) }, "revenue.tm": { $ne: null } })
        .select("storeId workDate shiftName shiftEnd createdAt employeeName revenue staffTotal")
        .lean()
    ).map((c) => ({
      id: String(c._id),
      storeId: String(c.storeId),
      workDate: c.workDate,
      shiftName: c.shiftName,
      shiftEnd: c.shiftEnd,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
      staff: c.employeeName || "?",
      revenue: (c.revenue ?? {}) as Partial<Revenue>,
      staffTotal: c.staffTotal,
    }));
  const [closings, history] = await Promise.all([load(from, to), load(addDays(from, -28), addDays(from, -1))]);
  const { items, byStaff } = detectAnomalies(closings, history, cfg.anomaly);
  const withStore = items.map((i) => ({ ...i, storeName: name.get(i.storeId) ?? "?" }));
  const staffRows = byStaff.map((s) => ({ ...s, storeName: name.get(s.storeId) ?? "?" }));
  let summary = ruleSummary(withStore, closings.length, stores.length);
  if (withStore.length) {
    try {
      const t = await geminiGenerate({
        feature: "anomaly",
        actor: opts.actor ?? "system",
        temperature: 0.2,
        timeoutMs: 25_000,
        prompt: `Bạn là trợ lý kiểm soát của chuỗi quán trà sữa Tiệm Bơ Sầu. Dưới đây là các BẤT THƯỜNG hệ thống đã tính từ dữ liệu chốt ca ${from} → ${to} (JSON, tiền VND; sev 3 = nghiêm trọng, 2 = cần xem, 1 = lưu ý) và thống kê theo nhân viên.
Viết 2–4 gạch đầu dòng tiếng Việt cho admin, mỗi dòng ≤ 30 từ: ai / cơ sở nào đáng lo nhất, kiểu lặp lại, và 1 việc nên làm. CHỈ dùng số có trong dữ liệu, không bịa, không kết tội. Mỗi dòng bắt đầu bằng "• ".
${JSON.stringify({ items: withStore.slice(0, 40).map(({ label, staff, storeName, workDate, shiftName, detail, sev }) => ({ label, staff, storeName, workDate, shiftName, detail, sev })), byStaff: staffRows.slice(0, 15) })}`,
      });
      const s = String(t ?? "").trim();
      if (s) summary = s.slice(0, 1500);
    } catch {
      /* AI tắt / hết lượt → giữ tóm tắt theo quy tắc */
    }
  }
  const run = await AnomalyRun.create({ from, to, items: withStore, byStaff: staffRows, summary });
  return run.toObject();
}

function ruleSummary(items: { sev: Sev; label: string; staff: string; storeName: string }[], n: number, stores: number) {
  if (!items.length) return `• ${n} lượt chốt ca ở ${stores} cơ sở – không có bất thường.`;
  const c3 = items.filter((i) => i.sev === 3).length;
  const c2 = items.filter((i) => i.sev === 2).length;
  return [`• ${n} lượt chốt ca · ${c3} nghiêm trọng · ${c2} cần xem · ${items.length - c3 - c2} lưu ý.`, ...items.filter((i) => i.sev === 3).slice(0, 3).map((i) => `• ${i.label}: ${i.staff} (${i.storeName})`)].join("\n");
}

export type AnomalyRunView = {
  from: string;
  to: string;
  summary: string;
  createdAt: Date;
  items: (AnomalyItem & { storeName: string; resolved: boolean })[];
  byStaff: (StaffStat & { storeName: string })[];
};

export async function latestAnomalyRun(): Promise<AnomalyRunView | null> {
  await connectDB();
  const run = await AnomalyRun.findOne().sort({ createdAt: -1 }).lean();
  if (!run) return null;
  const items = (run.items ?? []) as (AnomalyItem & { storeName: string })[];
  const done = new Set((await AnomalyResolved.find({ key: { $in: items.map((i) => i.key) } }).select("key").lean()).map((r) => r.key));
  return {
    from: run.from ?? "",
    to: run.to ?? "",
    summary: run.summary ?? "",
    createdAt: run.createdAt ?? new Date(),
    items: items.map((i) => ({ ...i, resolved: done.has(i.key) })),
    byStaff: (run.byStaff ?? []) as (StaffStat & { storeName: string })[],
  };
}

/** Cron hằng ngày: rà + gửi Telegram nhóm quản lý doanh thu (mỗi ngày 1 lần). */
export async function runDailyAnomaly() {
  await connectDB();
  const cfg = await getAiConfig();
  if (!cfg.features.anomaly.enabled) return "off";
  const key = `anomaly:${localDate(new Date())}`;
  if (await ReportLog.exists({ key, status: "SENT" })) return "done";
  const run = await runAnomaly();
  const items = run.items as (AnomalyItem & { storeName: string })[];
  if (cfg.anomaly.telegram && items.some((i) => i.sev >= 2)) {
    const chat = await financeChatId();
    if (telegramConfigured() && chat) {
      const top = items.filter((i) => i.sev >= 2).slice(0, 8);
      const icon = (s: Sev) => (s === 3 ? "🔴" : "🟠");
      const text = [`🔎 BẤT THƯỜNG CHỐT CA ${run.from.slice(8)}/${run.from.slice(5, 7)}–${run.to.slice(8)}/${run.to.slice(5, 7)}`, run.summary, "", ...top.map((i) => `${icon(i.sev)} ${i.label} – ${i.staff} (${i.storeName}, ${i.shiftName} ${i.workDate.slice(8)}/${i.workDate.slice(5, 7)}): ${i.detail}`)]
        .join("\n")
        .slice(0, 3900);
      await sendTelegramText(chat, text).catch(() => null);
    }
  }
  await ReportLog.updateOne({ key }, { $set: { status: "SENT", sentAt: new Date() } }, { upsert: true });
  return items.length;
}
