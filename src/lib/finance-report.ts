/* Báo cáo doanh thu – lợi nhuận gửi nhóm Telegram "Quản lý doanh thu" (ngày / tuần / tháng). */
import { connectDB } from "./db";
import { Attendance, ReportLog, ShiftAssignment, ShiftClosing, Settings, User, APPROVED_SHIFT } from "./models";
import { loadDayRevenue, loadPnl, loadStores, type StoreLite } from "./finance-data";
import { CATEGORY_LABEL, margin, revenueDeviation, type PnlLine } from "./finance";
import { closingSum, dayClosing, revenueDiff, type Revenue } from "./revenue";
import { geminiConfigured, geminiGenerate } from "./ocr";
import { sendTelegramText, telegramConfigured } from "./telegram";
import { addDays, localDate, prevMonth, viDate, viMonth, weekdayVi, DEFAULT_TZ } from "./time";
import { monthRange } from "./time";

const n = (x: number) => Math.round(x).toLocaleString("vi-VN");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${n(Math.abs(x))}`;

export async function financeChatId() {
  await connectDB();
  const s = await Settings.findOne({ key: "main" }).select("financeChatId").lean();
  return s?.financeChatId || process.env.TELEGRAM_FINANCE_CHAT_ID || "";
}

/* ---------- Dữ liệu cảnh báo trong ngày ---------- */
export type DayIssues = {
  cash: { store: string; shift: string; who: string; diff: number }[]; // âm/dương két
  noDt: { store: string; shift: string }[]; // ca chưa có DT máy (admin cần bổ sung)
  badTotal: { store: string; shift: string; who: string; written: number; real: number }[]; // NV cộng tổng sai
  missingClosing: { store: string; shifts: string[] }[]; // ca chưa chốt
  revenueDev: { store: string; dev: number }[]; // lệch so với TB cùng thứ 4 tuần trước
  late: { store: string; names: string[] }[];
  early: { store: string; names: string[] }[];
  noCheckout: { store: string; names: string[] }[];
  missed: { store: string; names: string[] }[]; // có lịch mà không chấm công
};

async function dayIssues(date: string, stores: StoreLite[]): Promise<DayIssues> {
  const name = (id: unknown) => stores.find((s) => s._id === String(id))?.short ?? "?";
  const closings = await ShiftClosing.find({ workDate: date }).select("storeId shiftName employeeName revenue staffTotal createdAt").lean();
  // chốt ca luỹ kế → âm/dương & DT máy của NGÀY lấy theo lượt chốt cuối của mỗi cơ sở
  const lastOf = stores.map((s) => dayClosing(closings.filter((c) => String(c.storeId) === s._id))).filter((c): c is (typeof closings)[number] => !!c);
  const cash = lastOf
    .map((c) => ({ store: name(c.storeId), shift: c.shiftName ?? "", who: c.employeeName ?? "", diff: c.revenue?.dt != null ? revenueDiff((c.revenue ?? {}) as Partial<Revenue>) : 0 }))
    .filter((c) => Math.abs(c.diff) >= 1000);
  const missingClosing = stores
    .map((s) => ({ store: s.short, shifts: ["Sáng", "Chiều", "Tối"].filter((sh) => !closings.some((c) => String(c.storeId) === s._id && c.shiftName === sh)) }))
    .filter((x) => x.shifts.length);
  // ca chưa chốt: chỉ báo các ca mà cơ sở có chốt thường xuyên (có ít nhất 1 lần chốt ca đó trong 14 ngày trước)
  const recent = await ShiftClosing.aggregate<{ _id: { s: unknown; sh: string } }>([
    { $match: { workDate: { $gte: addDays(date, -14), $lt: date } } },
    { $group: { _id: { s: "$storeId", sh: "$shiftName" } } },
  ]);
  const usual = new Set(recent.map((r) => `${name(r._id.s)}|${r._id.sh}`));
  for (const m of missingClosing) m.shifts = m.shifts.filter((sh) => usual.has(`${m.store}|${sh}`));

  // doanh thu thực thu (TK + TM + Shopee/Grab) – cùng nguồn với Lãi lỗ
  const thu = (d: { tm: number; tk: number; grab: number; shopee: number; cp: number }) => d.tm + d.tk + d.grab + d.shopee + d.cp;
  const pastDates = [7, 14, 21, 28].map((k) => addDays(date, -k));
  const hist = (await loadDayRevenue(pastDates[3], pastDates[0])).filter((d) => pastDates.includes(d.date));
  const today = await loadDayRevenue(date, date);
  const revenueDev: DayIssues["revenueDev"] = [];
  for (const s of stores) {
    const tr = today.find((d) => d.storeId === s._id);
    const t = tr ? thu(tr) : 0;
    const dev = revenueDeviation(t, hist.filter((h) => h.storeId === s._id).map(thu));
    if (dev !== null) revenueDev.push({ store: s.short, dev });
  }

  const atts = await Attendance.find({ workDate: date }).select("userId storeId lateMinutes earlyMinutes status").lean();
  const users = new Map(
    (await User.find({ _id: { $in: [...atts.map((a) => a.userId)] } }).select("name").lean()).map((u) => [String(u._id), u.name ?? ""]),
  );
  const group = (f: (a: (typeof atts)[number]) => boolean) =>
    stores
      .map((s) => ({ store: s.short, names: [...new Set(atts.filter((a) => String(a.storeId) === s._id && f(a)).map((a) => users.get(String(a.userId)) ?? "?"))] }))
      .filter((x) => x.names.length);

  const asg = await ShiftAssignment.find({ date, ...APPROVED_SHIFT }).select("userId storeId").lean();
  const worked = new Set(atts.map((a) => String(a.userId)));
  const missUsers = asg.filter((a) => !worked.has(String(a.userId)));
  const missNames = new Map((await User.find({ _id: { $in: missUsers.map((a) => a.userId) } }).select("name").lean()).map((u) => [String(u._id), u.name ?? ""]));
  const missed = stores
    .map((s) => ({ store: s.short, names: [...new Set(missUsers.filter((a) => String(a.storeId) === s._id).map((a) => missNames.get(String(a.userId)) ?? "?"))] }))
    .filter((x) => x.names.length);

  return {
    cash,
    noDt: lastOf.filter((c) => c.revenue?.tm != null && c.revenue?.dt == null).map((c) => ({ store: name(c.storeId), shift: c.shiftName ?? "" })),
    badTotal: closings
      .filter((c) => c.staffTotal != null && c.revenue?.tm != null && c.staffTotal !== closingSum((c.revenue ?? {}) as Partial<Revenue>))
      .map((c) => ({ store: name(c.storeId), shift: c.shiftName ?? "", who: c.employeeName ?? "", written: c.staffTotal!, real: closingSum((c.revenue ?? {}) as Partial<Revenue>) })),
    missingClosing: missingClosing.filter((m) => m.shifts.length),
    revenueDev,
    late: group((a) => (a.lateMinutes ?? 0) > 0),
    early: group((a) => (a.earlyMinutes ?? 0) > 0),
    noCheckout: group((a) => a.status === "MISSING_CHECKOUT"),
    missed,
  };
}

export function issueLines(i: DayIssues) {
  const out: string[] = [];
  for (const m of i.missingClosing) out.push(`${m.store}: chưa chốt ca ${m.shifts.join(", ")}`);
  for (const c of i.noDt) out.push(`${c.store}${c.shift ? ` Ca ${c.shift}` : ""}: chưa có DT máy – admin bổ sung để tính âm/dương`);
  for (const c of i.badTotal)
    out.push(`${c.store}${c.shift ? ` Ca ${c.shift}` : ""}${c.who ? ` (${c.who})` : ""}: cộng tổng sai – ghi ${n(c.written)}, đúng ${n(c.real)}`);
  for (const c of i.cash) out.push(`${c.store}${c.shift ? ` Ca ${c.shift}` : ""}${c.who ? ` (${c.who})` : ""}: ${c.diff < 0 ? "âm" : "dư"} ${n(Math.abs(c.diff))} đ`);
  for (const r of i.revenueDev) out.push(`${r.store}: doanh thu ${r.dev < 0 ? "thấp" : "cao"} hơn ${pct(Math.abs(r.dev))} so với TB cùng thứ 4 tuần trước`);
  for (const m of i.missed) out.push(`${m.store}: có lịch nhưng không chấm công – ${m.names.join(", ")}`);
  for (const l of i.late) out.push(`${l.store}: đi muộn – ${l.names.join(", ")}`);
  for (const l of i.early) out.push(`${l.store}: về sớm – ${l.names.join(", ")}`);
  for (const l of i.noCheckout) out.push(`${l.store}: quên check-out – ${l.names.join(", ")}`);
  return out;
}

/* ---------- Nhận xét AI (không bắt buộc) ---------- */
async function aiComment(kind: string, data: unknown): Promise<string | null> {
  if (!geminiConfigured()) return null;
  const s = await Settings.findOne({ key: "main" }).select("financeAiComment").lean();
  if (s?.financeAiComment === false) return null;
  try {
    const text = await geminiGenerate({
      prompt: `Bạn là trợ lý quản lý chuỗi 3 quán trà sữa "Tiệm Bơ Sầu". Dưới đây là số liệu ${kind} (JSON, tiền VND; profit là lợi nhuận ƯỚC TÍNH).
Viết 2–4 gạch đầu dòng tiếng Việt, mỗi dòng ≤ 25 từ, cho chủ quán: điểm đáng chú ý nhất, so sánh giữa các cơ sở, và 1 gợi ý hành động cụ thể.
CHỈ dùng số có trong dữ liệu, không bịa. Không chào hỏi, không markdown đậm, mỗi dòng bắt đầu bằng "• ".

${JSON.stringify(data)}`,
      temperature: 0.3,
      timeoutMs: 25_000,
      feature: "reportComment",
    });
    const t = String(text ?? "").trim();
    return t ? t.slice(0, 1200) : null;
  } catch {
    return null;
  }
}

const storeLine = (name: string, l: PnlLine) =>
  `🏪 ${name}\n   DT ${n(l.revenue)} · lương ${n(l.labor)} · két ${n(l.cashbox)}`;
const chainLines = (t: PnlLine) => [
  `Σ Doanh thu thật 3 cơ sở: ${n(t.revenue)} (TK + TM + Shopee/Grab + két)`,
  `   − Chi phí két: ${n(t.cashbox)}`,
  `   − Lương NV: ${n(t.labor)}`,
  `   − Chi phí (admin nhập): ${n(t.shared)}`,
  `   − Mặt bằng: ${n(t.fixed)}`,
  `   − Phí sàn Shopee/Grab: ${n(t.platformFee)}`,
  ...(t.direct ? [`   − Chi phí gắn riêng CS: ${n(t.direct)}`] : []),
  `   Tổng chi phí: ${n(t.cost)}`,
  `💰 LÃI ≈ ${signed(t.profit)} (${pct(margin(t))})`,
];

/* ---------- Báo cáo ngày ---------- */
export async function buildDailyReport(date: string) {
  await connectDB();
  const stores = await loadStores();
  const [{ pnl }, issues, month] = await Promise.all([loadPnl(date, date, stores), dayIssues(date, stores), loadPnl(`${date.slice(0, 7)}-01`, date, stores)]);
  const lines: string[] = [`📊 BÁO CÁO NGÀY ${viDate(date)} (${weekdayVi(date)})`, ""];
  for (const s of stores) {
    const l = pnl.byStore[s._id];
    const cashDiff = issues.cash.filter((c) => c.store === s.short).reduce((a, c) => a + c.diff, 0);
    lines.push(storeLine(s.short, l));
    lines.push(`   Két: ${cashDiff === 0 ? "✅ khớp" : `⚠️ ${cashDiff < 0 ? "âm" : "dư"} ${n(Math.abs(cashDiff))}`}`);
  }
  lines.push("━━━━━━━━━━", ...chainLines(pnl.total));
  lines.push(`📅 Luỹ kế T${viMonth(date.slice(0, 7))}: DT ${n(month.pnl.total.revenue)} · chi phí chung ${n(month.pnl.total.shared)} · lãi chuỗi ≈ ${signed(month.pnl.total.profit)}`);
  const iss = issueLines(issues);
  if (iss.length) lines.push("", "⚠️ Cần chú ý", ...iss.map((x) => `• ${x}`));
  const ai = await aiComment("trong ngày", {
    date,
    stores: stores.map((s) => ({ name: s.short, revenue: pnl.byStore[s._id].revenue, storeContribution: pnl.byStore[s._id].contribution })),
    chain: { revenue: pnl.total.revenue, commonCosts: pnl.total.shared, chainProfit: pnl.total.profit },
    monthToDate: { revenue: month.pnl.total.revenue, commonCosts: month.pnl.total.shared, chainProfit: month.pnl.total.profit },
    issues: iss,
  });
  if (ai) lines.push("", "💬 Nhận xét", ai);
  lines.push("", "Doanh thu thật = TK + TM + Shopee/Grab + két. Lãi = Doanh thu thật − két − lương − chi phí − mặt bằng − phí sàn (ước tính).");
  return lines.join("\n");
}

/* ---------- Báo cáo tuần / tháng ---------- */
export async function buildPeriodReport(from: string, to: string, prevFrom: string, prevTo: string, title: string) {
  await connectDB();
  const stores = await loadStores();
  const [{ pnl }, prev] = await Promise.all([loadPnl(from, to, stores), loadPnl(prevFrom, prevTo, stores)]);
  const lines: string[] = [title, `${viDate(from)} – ${viDate(to)}`, ""];
  const ranked = [...stores].sort((a, b) => pnl.byStore[b._id].revenue - pnl.byStore[a._id].revenue);
  for (const s of ranked) {
    const l = pnl.byStore[s._id];
    const p = prev.pnl.byStore[s._id];
    const chg = p?.revenue ? (l.revenue - p.revenue) / p.revenue : null;
    lines.push(storeLine(s.short, l));
    if (chg !== null) lines.push(`   DT ${chg >= 0 ? "▲" : "▼"} ${pct(Math.abs(chg))} so kỳ trước`);
  }
  const t = pnl.total;
  const pt = prev.pnl.total;
  lines.push("━━━━━━━━━━", ...chainLines(t));
  if (pt.revenue) lines.push(`   Kỳ trước: DT ${n(pt.revenue)} · lãi chuỗi ≈ ${signed(pt.profit)}`);
  const costParts: [string, number][] = [
    ["Lương NV", t.labor + (pnl.byCategory.LUONG ?? 0)],
    ["Mặt bằng", t.fixed],
    ["Phí sàn", t.platformFee],
    ...Object.entries(pnl.byCategory)
      .filter(([k]) => k !== "LUONG")
      .map(([k, v]) => [CATEGORY_LABEL[k] ?? k, v] as [string, number]),
  ];
  const top = costParts.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (top.length) lines.push("", "💸 Chi phí lớn nhất", ...top.map(([k, v]) => `• ${k}: ${n(v)} (${t.revenue ? pct(v / t.revenue) : "–"} DT)`));
  // cảnh báo tổng hợp của kỳ
  const closings = await ShiftClosing.find({ workDate: { $gte: from, $lte: to }, "revenue.tm": { $ne: null } }).select("storeId workDate shiftName createdAt revenue").lean();
  const neg = stores
    .map((s) => {
      // mỗi ngày chỉ xét lượt chốt cuối (luỹ kế cả ngày)
      const mine = closings.filter((c) => String(c.storeId) === s._id);
      const list = [...new Set(mine.map((c) => c.workDate))]
        .map((d) => dayClosing(mine.filter((c) => c.workDate === d))!)
        .filter((c) => c.revenue?.dt != null)
        .map((c) => revenueDiff((c.revenue ?? {}) as Partial<Revenue>));
      return { s: s.short, cnt: list.filter((d) => d < -1000).length, sum: list.filter((d) => d < -1000).reduce((a, b) => a + b, 0) };
    })
    .filter((x) => x.cnt);
  const late = await Attendance.aggregate<{ _id: unknown; c: number }>([
    { $match: { workDate: { $gte: from, $lte: to }, lateMinutes: { $gt: 0 } } },
    { $group: { _id: "$storeId", c: { $sum: 1 } } },
  ]);
  const warn = [
    ...neg.map((x) => `${x.s}: ${x.cnt} ngày âm két, tổng ${n(Math.abs(x.sum))} đ`),
    ...late.map((x) => `${stores.find((s) => s._id === String(x._id))?.short ?? "?"}: ${x.c} lượt đi muộn`),
  ];
  if (warn.length) lines.push("", "⚠️ Cần chú ý", ...warn.map((x) => `• ${x}`));
  const ai = await aiComment(title.toLowerCase(), {
    from,
    to,
    stores: stores.map((s) => ({ name: s.short, revenue: pnl.byStore[s._id].revenue, storeContribution: pnl.byStore[s._id].contribution, prevRevenue: prev.pnl.byStore[s._id]?.revenue ?? 0 })),
    chain: { revenue: t.revenue, commonCosts: t.shared, chainProfit: t.profit, prevRevenue: pt.revenue, prevChainProfit: pt.profit },
    topCosts: top,
    warnings: warn,
  });
  if (ai) lines.push("", "💬 Nhận xét", ai);
  return lines.join("\n");
}

/* ---------- Gửi (mỗi key chỉ 1 lần) ---------- */
export async function sendReportOnce(key: string, build: () => Promise<string>, force = false) {
  await connectDB();
  if (!force && (await ReportLog.findOne({ key, status: "SENT" }).lean())) return "SKIPPED" as const;
  const chat = await financeChatId();
  if (!telegramConfigured() || !chat) return "DISABLED" as const;
  try {
    const text = await build();
    await sendTelegramText(chat, text.slice(0, 4000));
    await ReportLog.updateOne({ key }, { $set: { status: "SENT", sentAt: new Date() }, $unset: { error: 1 } }, { upsert: true });
    return "SENT" as const;
  } catch (e) {
    await ReportLog.updateOne({ key }, { $set: { status: "FAILED", error: (e as Error).message, sentAt: new Date() } }, { upsert: true });
    return "FAILED" as const;
  }
}

async function reportFlags() {
  const s = await Settings.findOne({ key: "main" }).select("financeReportDaily financeReportWeekly financeReportMonthly").lean();
  return { daily: s?.financeReportDaily !== false, weekly: s?.financeReportWeekly !== false, monthly: s?.financeReportMonthly !== false };
}

export const sendDailyReport = (date: string, force = false) => sendReportOnce(`daily:${date}`, () => buildDailyReport(date), force);

export function sendWeeklyReport(weekStart: string, force = false) {
  const to = addDays(weekStart, 6);
  return sendReportOnce(`weekly:${weekStart}`, () => buildPeriodReport(weekStart, to, addDays(weekStart, -7), addDays(weekStart, -1), "📈 BÁO CÁO TUẦN"), force);
}

export function sendMonthlyReport(month: string, force = false) {
  const { first, last } = monthRange(month);
  const p = monthRange(prevMonth(month));
  return sendReportOnce(`monthly:${month}`, () => buildPeriodReport(first, last, p.first, p.last, `📆 BÁO CÁO THÁNG ${viMonth(month)}`), force);
}

/** Sau khi chốt ca Tối: tất cả cơ sở đã chốt ca Tối → gửi báo cáo ngày luôn. */
export async function maybeSendDailyAfterClosing(date: string) {
  if (!(await reportFlags()).daily) return null;
  const stores = await loadStores();
  const done = await ShiftClosing.distinct("storeId", { workDate: date, shiftName: "Tối" });
  if (stores.some((s) => !done.some((d) => String(d) === s._id))) return null;
  return sendDailyReport(date);
}

/** Cron (01:00 giờ VN): báo cáo ngày hôm qua nếu chưa gửi; thứ 2 → báo cáo tuần trước; ngày 1 → báo cáo tháng trước. */
export async function runScheduledReports(now = new Date()) {
  const f = await reportFlags();
  const today = localDate(now, DEFAULT_TZ);
  const out: Record<string, string> = {};
  if (f.daily) out.daily = await sendDailyReport(addDays(today, -1));
  if (f.weekly && weekdayVi(today) === "Thứ 2") out.weekly = await sendWeeklyReport(addDays(today, -7));
  if (f.monthly && today.endsWith("-01")) out.monthly = await sendMonthlyReport(prevMonth(today.slice(0, 7)));
  return out;
}
