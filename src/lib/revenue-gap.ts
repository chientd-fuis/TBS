import { Types } from "mongoose";
import { connectDB } from "./db";
import { BonusPenalty, RevenueGap, ShiftClosing, Store, User } from "./models";
import { closingSum, parseMoney, sortClosings } from "./revenue";
import { getSettings } from "./settings";
import { viDate, weekdayVi } from "./time";

/*
 * BÙ DOANH THU – ngày THIẾU tiền (thực thu < DT máy) → yêu cầu phạt chờ admin duyệt.
 * Chạy lại mỗi khi doanh thu ngày tính lại (recomputeDay): nhân viên chốt ca, admin sửa DT máy, import DT máy KiotViet.
 *
 * Chia lệch theo ca (số chốt ca LUỸ KẾ):
 *  - Ca có DT máy: lệch riêng = lệch luỹ kế ca đó − lệch luỹ kế ca trước (source "calc").
 *  - Ghi chú nhân viên nhắc ca khác: "ca sáng âm 10k", "ca chieu du 10k" → ca đó lấy đúng số này (source "note").
 *  - Ca cuối đã chốt nhận phần còn lại (source "rest"): VD cả ngày −70k, ca Sáng ghi âm 10k → ca Tối −60k;
 *    ca Sáng dư +10k → ca Tối −80k. Ca DƯ tiền không bị phạt, chỉ ghi nhận.
 *  - Ghi chú khác cần biết (đơn chưa thanh toán, thu chi, ghi chú ca) đưa nguyên văn vào yêu cầu.
 */

type Id = string | Types.ObjectId;
export type GapPart = { closingId?: unknown; shiftName: string; userId?: unknown; name: string; amount: number; source: "calc" | "note" | "rest"; quote?: string };
export type GapNote = { shiftName: string; kind: "unpaid" | "note" | "cp"; text: string };

/** bỏ dấu tiếng Việt + chữ thường → so khớp ghi chú gõ có dấu / không dấu */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase();

const SHORT = /\b(am|thieu|hut|lech|mat)\b/; // âm, thiếu, hụt, lệch, mất
const OVER = /\b(du|thua|lo)\b/; // dư, thừa
const UNPAID = /chua\s*(tt|thanh\s*toan|tra|ck|chuyen)|ghi\s*no|khach\s*no|\bno\b|ck\s*sau|tra\s*sau|chuyen\s*sau|chua\s*nhan\s*tien/;
const MONEY = /([-+−]?\s*\d[\d.,]*\s*(?:k|tr\d{0,3}|nghin|ngan|d)?)/;

/**
 * Đọc ghi chú 1 ca: tìm "ca <tên ca khác> <âm/thiếu/dư/thừa> <số>" (hoặc "<số>" có dấu −/+).
 * shiftNames: tên các ca của cơ sở (Sáng, Chiều, Tối…). Trả các nhắc tới ca khác + có phải đơn chưa thanh toán.
 */
export function parseGapNote(text: string, shiftNames: string[]) {
  const t = fold(text);
  const mentions: { shiftName: string; amount: number; quote: string }[] = [];
  for (const name of shiftNames) {
    const n = fold(name);
    // phần sau "ca <tên>" tới dấu ; / xuống dòng / "|" (không cắt ở dấu chấm vì số tiền viết "10.000")
    const re = new RegExp(`ca\\s*${n}\\b([^;\\n|]{0,40})`, "g");
    for (const m of t.matchAll(re)) {
      const tail = m[1];
      const money = MONEY.exec(tail);
      if (!money) continue;
      const raw = money[1].replace(/\s+/g, "").replace("−", "-").replace(/nghin|ngan/, "k").replace(/d$/, "");
      const v = parseMoney(raw.replace(/^[-+]/, ""));
      if (v == null || v === 0) continue;
      const before = tail.slice(0, money.index);
      const neg = raw.startsWith("-") || SHORT.test(before) || (!raw.startsWith("+") && !OVER.test(before) && SHORT.test(tail));
      const pos = raw.startsWith("+") || OVER.test(before);
      if (!neg && !pos) continue; // chỉ có số, không rõ âm hay dư → để admin đọc nguyên văn
      const start = m.index ?? 0;
      mentions.push({ shiftName: name, amount: neg ? -Math.abs(v) : Math.abs(v), quote: text.slice(start, start + m[0].length).trim() });
    }
  }
  return { mentions, unpaid: UNPAID.test(t) };
}

/** Tính lệch + chia theo ca cho 1 ngày từ các lượt chốt ca (chưa ghi DB). null = ngày chưa có DT máy. */
export async function computeGap(storeId: Id, date: string) {
  await connectDB();
  const list = sortClosings(
    await ShiftClosing.find({ storeId, workDate: date, "revenue.tm": { $ne: null } })
      .select("revenue revenueInput note shiftName employeeName userId createdAt")
      .lean(),
  );
  const last = list[list.length - 1];
  if (!last || last.revenue?.dt == null) return null;
  const real = closingSum(last.revenue ?? {});
  const dt = Number(last.revenue.dt) || 0;
  const total = real - dt;
  const shiftNames = [...new Set(list.map((c) => c.shiftName).filter(Boolean) as string[])];
  const names = new Map((await User.find({ _id: { $in: list.map((c) => c.userId).filter(Boolean) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const who = (c: (typeof list)[number]) => (c.userId && names.get(String(c.userId))) || c.employeeName || "?";

  // lệch luỹ kế từng ca (ca có DT máy) → lệch riêng
  const parts: GapPart[] = [];
  let prevCum = 0;
  for (const c of list.slice(0, -1)) {
    if (c.revenue?.dt == null) continue;
    const cum = closingSum(c.revenue ?? {}) - (Number(c.revenue.dt) || 0);
    const own = cum - prevCum;
    prevCum = cum;
    if (own) parts.push({ closingId: c._id, shiftName: c.shiftName ?? "", userId: c.userId, name: who(c), amount: own, source: "calc" });
  }
  // ghi chú nhắc ca khác → ghi đè số của ca đó
  const notes: GapNote[] = [];
  for (const c of list) {
    const sn = c.shiftName ?? "";
    if (c.note?.trim()) {
      const p = parseGapNote(c.note, shiftNames);
      notes.push({ shiftName: sn, kind: p.unpaid ? "unpaid" : "note", text: c.note.trim().slice(0, 300) });
      for (const m of p.mentions) {
        if (m.shiftName === (last.shiftName ?? "")) continue; // ca cuối luôn nhận phần còn lại
        const tgt = list.find((x) => x.shiftName === m.shiftName);
        const i = parts.findIndex((x) => x.shiftName === m.shiftName);
        const part: GapPart = { closingId: tgt?._id, shiftName: m.shiftName, userId: tgt?.userId, name: tgt ? who(tgt) : "?", amount: m.amount, source: "note", quote: m.quote };
        if (i >= 0) parts[i] = part;
        else parts.push(part);
      }
    }
    const cpText = c.revenueInput?.cp;
    if (cpText && /[a-zA-ZÀ-ỹ]/.test(cpText)) notes.push({ shiftName: sn, kind: UNPAID.test(fold(cpText)) ? "unpaid" : "cp", text: `Thu chi: ${cpText}`.slice(0, 300) });
  }
  const others = parts.reduce((s, p) => s + p.amount, 0);
  const rest = total - others;
  if (rest) parts.push({ closingId: last._id, shiftName: last.shiftName ?? "", userId: last.userId, name: who(last), amount: rest, source: "rest" });
  return { dt, real, total, lastShift: last.shiftName ?? "", parts: sortParts(parts, shiftNames), notes };
}

const sortParts = (p: GapPart[], order: string[]) => [...p].sort((a, b) => order.indexOf(a.shiftName) - order.indexOf(b.shiftName));

/**
 * Sau khi doanh thu ngày tính lại: thiếu ≥ ngưỡng → tạo / cập nhật yêu cầu bù doanh thu (PENDING) + báo nhóm Yêu cầu.
 * Hết thiếu (đã sửa số) → xoá yêu cầu còn chờ. Đã duyệt / từ chối → không mở lại, chỉ ghi số mới để admin biết.
 */
export async function syncRevenueGap(storeId: Id, date: string) {
  try {
    const st = await getSettings();
    if (st.revenueGapOn === false) return null; // Cài đặt: tắt bù doanh thu → không tạo / không đổi yêu cầu nào
    const g = await computeGap(storeId, date);
    const min = Math.max(0, st.revenueGapMin ?? 10000);
    const cur = await RevenueGap.findOne({ storeId, date });
    const short = !!g && g.total < 0 && -g.total >= Math.max(min, 1);
    if (!short) {
      if (cur?.status === "PENDING") await RevenueGap.deleteOne({ _id: cur._id, status: "PENDING" });
      else if (cur && g && g.total !== cur.total) await RevenueGap.updateOne({ _id: cur._id }, { $set: { totalAfterDecision: g.total } });
      return null;
    }
    if (cur && cur.status !== "PENDING") {
      if (g.total !== cur.total) await RevenueGap.updateOne({ _id: cur._id }, { $set: { totalAfterDecision: g.total } });
      return cur;
    }
    const doc = await RevenueGap.findOneAndUpdate(
      { storeId, date },
      { $set: { month: date.slice(0, 7), status: "PENDING", dt: g.dt, real: g.real, total: g.total, lastShift: g.lastShift, parts: g.parts, notes: g.notes } },
      { upsert: true, returnDocument: "after" },
    );
    // báo nhóm: lần đầu, hoặc số thiếu đổi từ ngưỡng trở lên so với lần đã báo
    if (doc && (doc.notifiedTotal == null || Math.abs((doc.notifiedTotal ?? 0) - g.total) >= min)) {
      await notifyRevenueGap(String(doc._id), doc.notifiedTotal != null);
      await RevenueGap.updateOne({ _id: doc._id }, { $set: { notifiedAt: new Date(), notifiedTotal: g.total } });
    }
    return doc;
  } catch (e) {
    console.error("[revenue gap]", (e as Error).message);
    return null;
  }
}

const vnd = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(Math.round(n)).toLocaleString("vi-VN")}`;
const SRC: Record<string, string> = { calc: "", note: " (theo ghi chú)", rest: "" };

/** Nội dung yêu cầu (dùng chung tin Telegram) */
export function gapLines(g: { date: string; dt?: number | null; real?: number | null; total?: number | null; parts?: GapPart[]; notes?: GapNote[] }, storeName: string) {
  const parts = g.parts ?? [];
  const others = parts.filter((p) => p.source !== "rest");
  return [
    "💸 BÙ DOANH THU – THIẾU TIỀN",
    `🏪 Cơ sở: ${storeName.replace(/^TBS\s+/i, "")}`,
    `📅 Ngày: ${viDate(g.date).slice(0, 5)} (${weekdayVi(g.date)})`,
    `🧾 DT máy: ${(g.dt ?? 0).toLocaleString("vi-VN")} · Thực thu: ${(g.real ?? 0).toLocaleString("vi-VN")}`,
    `➖ Lệch cả ngày: ${vnd(g.total ?? 0)}`,
    ...parts.map(
      (p) =>
        `• Ca ${p.shiftName} – ${p.name}: ${vnd(p.amount)}${p.amount > 0 ? " (dư – không phạt)" : ""}${SRC[p.source] ?? ""}${p.quote ? ` “${p.quote}”` : ""}${
          p.source === "rest" && others.length ? ` (= ${vnd(g.total ?? 0)} − (${vnd(others.reduce((s, x) => s + x.amount, 0))}))` : ""
        }`,
    ),
    ...((g.notes ?? []).length ? ["📝 Ghi chú cần biết:", ...(g.notes ?? []).map((n) => ` ${n.kind === "unpaid" ? "⚠ Đơn chưa thanh toán" : "•"} Ca ${n.shiftName}: ${n.text}`)] : []),
  ];
}

async function notifyRevenueGap(id: string, updated: boolean) {
  const g = await RevenueGap.findById(id).lean();
  if (!g) return;
  const { queueOrSendRequest } = await import("./request-notify");
  const store = await Store.findById(g.storeId).select("name").lean();
  const lines = gapLines(g as never, store?.name ?? "");
  if (updated) lines[0] = "💸 BÙ DOANH THU – CẬP NHẬT SỐ THIẾU";
  await queueOrSendRequest(g.storeId, lines, { kind: "revenueGap", perm: "revenue", where: "Yêu cầu → Bù doanh thu để Duyệt (ghi phạt) / Không phạt" });
}

/** Admin duyệt: ghi phạt từng người (số admin chốt, chỉ phần thiếu). Trả tổng đã phạt. */
export async function approveRevenueGap(id: string, amounts: Record<number, number>, by: string, reply: string) {
  await connectDB();
  const g = await RevenueGap.findOneAndUpdate({ _id: id, status: "PENDING" }, { $set: { lockedAt: new Date() } }, { returnDocument: "after" });
  if (!g) throw new Error("Yêu cầu đã được xử lý");
  try {
    const dm = `${g.date.slice(8)}/${g.date.slice(5, 7)}`;
    const penalties: { userId: unknown; name: string; amount: number; shiftName: string }[] = [];
    for (const [i, p] of (g.parts ?? []).entries()) {
      const amt = Math.max(0, Math.round(amounts[i] ?? (p.amount && p.amount < 0 ? -p.amount : 0)));
      if (!amt || !p.userId) continue;
      await BonusPenalty.updateOne(
        { autoKey: `gap:${g._id}:${i}` },
        {
          $set: {
            userId: p.userId,
            storeId: g.storeId,
            kind: "PENALTY",
            date: g.date,
            month: g.month,
            amountVnd: amt,
            content: `Bù doanh thu thiếu ${dm} (ca ${p.shiftName})${reply ? ` – ${reply}` : ""}`.slice(0, 300),
            createdBy: by,
            autoEdited: true, // không để phạt tự động ghi đè
          },
        },
        { upsert: true },
      );
      penalties.push({ userId: p.userId, name: p.name ?? "", amount: amt, shiftName: p.shiftName ?? "" });
    }
    await RevenueGap.updateOne({ _id: g._id }, { $set: { status: "APPROVED", decidedBy: by, decidedAt: new Date(), reply, penalties }, $unset: { lockedAt: 1 } });
    return penalties.reduce((s, p) => s + p.amount, 0);
  } catch (e) {
    await RevenueGap.updateOne({ _id: g._id }, { $unset: { lockedAt: 1 } });
    throw e;
  }
}

export async function rejectRevenueGap(id: string, by: string, reply: string) {
  await connectDB();
  const r = await RevenueGap.updateOne({ _id: id, status: "PENDING" }, { $set: { status: "REJECTED", decidedBy: by, decidedAt: new Date(), reply } });
  if (!r.modifiedCount) throw new Error("Yêu cầu đã được xử lý");
}
