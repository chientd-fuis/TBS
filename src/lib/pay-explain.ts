/*
 * Giải thích lương cho nhân viên: AI đọc bảng lương ĐÃ CÔNG BỐ của chính người đó (không xem dữ liệu người khác)
 * + thưởng/phạt + lượt được cộng giờ + ngày lễ + so với tháng trước → viết giải thích từng bước.
 */
import { Attendance, BonusPenalty, Payroll, PayrollItem } from "./models";
import { prevMonth } from "./time";
import { geminiGenerate } from "./ocr";

export async function explainMyPay(user: { _id: unknown; name?: string | null }, month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Tháng không hợp lệ");
  const published = async (m: string) => {
    const items = await PayrollItem.find({ userId: user._id, month: m }).lean();
    const pays = await Payroll.find({ _id: { $in: items.map((i) => i.payrollId) }, status: { $ne: "DRAFT" } }).select("_id").lean();
    const ok = new Set(pays.map((p) => String(p._id)));
    return items.filter((i) => ok.has(String(i.payrollId)));
  };
  const items = await published(month);
  if (!items.length) throw new Error("Bảng lương tháng này chưa được công bố");
  const [prev, bps, extra] = await Promise.all([
    published(prevMonth(month)),
    BonusPenalty.find({ userId: user._id, month }).select("kind amountVnd content date").sort({ date: 1 }).lean(),
    Attendance.find({ userId: user._id, month, extraHours: { $gt: 0 } }).select("workDate extraHours").lean(),
  ]);
  const pick = (i: (typeof items)[number]) => ({
    totalHours: i.totalHours,
    workDays: i.workDays,
    payType: i.payType === "FULLTIME" ? "full-time (lương cứng)" : "part-time (lương giờ)",
    hourlyWage: i.hourlyWage,
    monthlySalary: i.monthlySalary ?? 0,
    paidLeaveDays: i.paidLeaveDays ?? 0,
    basePay: i.basePay,
    allowance: i.allowance,
    totalBonus: i.totalBonus,
    totalPenalty: i.totalPenalty,
    advance: i.advance,
    netPay: i.netPay,
    holidayHours: i.holidayHours || 0,
    holidayExtra: i.holidayExtra || 0,
    holidayNote: i.holidayNote || "",
    supportNote: i.supportNote || "",
    lateCount: i.lateCount,
    earlyCount: i.earlyCount,
  });
  const data = {
    month,
    payroll: items.map(pick),
    bonusPenalty: bps.map((b) => ({ kind: b.kind === "BONUS" ? "thưởng" : "phạt", amount: b.amountVnd, content: b.content, date: b.date })),
    plusHours: extra.map((a) => ({ date: a.workDate, hours: a.extraHours })),
    previousMonth: prev.length ? prev.map(pick) : null,
  };
  const text = await geminiGenerate({
    feature: "payExplain",
    actor: `user:${user._id}`,
    temperature: 0.2,
    timeoutMs: 45_000,
    prompt: `Bạn giải thích BẢNG LƯƠNG tháng ${month} cho nhân viên quán trà sữa Tiệm Bơ Sầu (xưng "mình", gọi "bạn"), tiếng Việt, dễ hiểu.
Công thức: Thực nhận = Lương cơ bản + Phụ cấp + Thưởng − Phạt − Tạm ứng. Part-time: Lương cơ bản = giờ tính công × lương giờ (giờ làm ngày lễ được nhân hệ số, đã gồm trong lương cơ bản). Full-time: Lương cơ bản = lương cứng tháng (monthlySalary), giờ công chỉ để theo dõi; nghỉ quá số ngày nghỉ có lương (paidLeaveDays) bị trừ trong tạm ứng (ghi chú "Nghỉ không lương").
Viết danh sách đánh số 3–6 dòng: giờ công (nêu các ngày được cộng thêm giờ nếu có), lương cơ bản, phụ cấp / thưởng / phạt (kèm lý do từng khoản), tạm ứng, thực nhận.
Nếu có tháng trước: 1 câu so sánh, nêu nguyên nhân chính chênh lệch. CHỈ dùng số trong dữ liệu (định dạng 1.234.567 ₫), không bịa, không markdown đậm.
Dữ liệu (JSON):
${JSON.stringify(data)}`,
  });
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Chưa giải thích được – thử lại sau");
  return t.slice(0, 2500);
}
