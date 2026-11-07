import { addDays, zonedToDate } from "./time";

/*
 * Bảng chấm công theo CA cả tháng (giống bảng xếp ca chế độ xem): hàng = ca làm việc của cơ sở,
 * cột = ngày. Hàm thuần – có unit test.
 */

export type BoardTpl = { id: string; name: string; startTime: string; endTime: string };
export type BoardAssign = { id: string; userId: string; tplId: string; date: string; startTime: string; endTime: string };
export type BoardAtt = {
  id: string;
  userId: string;
  storeId: string; // nơi làm thực tế
  homeStoreId: string; // cơ sở gốc
  workDate: string;
  checkInAt: Date;
  checkOutAt?: Date | null;
  status: string;
  lateMinutes?: number | null;
  earlyMinutes?: number | null;
  outOfShift?: boolean | null;
};
export type BoardChip = {
  key: string;
  userId: string;
  name: string;
  /** cơ sở để mở bảng chấm công chi tiết (cơ sở gốc của nhân viên) */
  linkStoreId: string;
  state: "worked" | "missed" | "upcoming" | "pending"; // pending = đăng ký chờ duyệt
  late?: number;
  early?: number;
  extra?: boolean; // làm thêm ca (không có lịch)
  missingOut?: boolean; // quên check-out
  /** CSx – đi hỗ trợ cơ sở khác (away) hoặc từ cơ sở khác sang (from) */
  tag?: { label: string; kind: "away" | "from"; storeId: string };
};

const win = (date: string, start: string, end: string, tz: string) => {
  const s = zonedToDate(date, start, tz);
  let e = zonedToDate(date, end, tz);
  if (e <= s) e = zonedToDate(addDays(date, 1), end, tz);
  return [s.getTime(), e.getTime()] as const;
};
const overlap = (a: readonly [number, number], b: readonly [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

export function buildMonthBoard(input: {
  storeId: string;
  tz: string;
  days: string[];
  templates: BoardTpl[];
  assignments: BoardAssign[]; // ca đã duyệt ở cơ sở này trong tháng
  pending?: BoardAssign[]; // đăng ký ca đang chờ duyệt (hiện cho nhân viên xem)
  attendances: BoardAtt[]; // chấm công tại cơ sở này + của nhân viên cơ sở này đi hỗ trợ nơi khác
  names: Record<string, string>;
  homeOf: Record<string, string>; // userId → cơ sở gốc
  storeTag: Record<string, string>; // storeId → "CS1"…
  now: Date;
  minRows?: number; // số dòng tối thiểu mỗi ca (mặc định 2; trang nhân viên 1)
}) {
  const { storeId, tz, days, templates, names, homeOf, storeTag } = input;
  const cells: Record<string, BoardChip[]> = {}; // `${date}|${tplId}`
  const push = (date: string, tplId: string, c: BoardChip) => ((cells[`${date}|${tplId}`] ??= []).push(c));
  const attWin = (a: BoardAtt) =>
    [a.checkInAt.getTime(), (a.checkOutAt ?? (a.status === "OPEN" ? input.now : new Date(a.checkInAt.getTime() + 3600_000))).getTime()] as const;
  const used = new Set<string>(); // lượt chấm công đã gắn vào ít nhất 1 ca có lịch
  const tagFor = (a: BoardAtt): BoardChip["tag"] =>
    a.storeId !== storeId
      ? { label: storeTag[a.storeId] ?? "CS?", kind: "away", storeId: a.storeId }
      : a.homeStoreId !== storeId
        ? { label: storeTag[a.homeStoreId] ?? "CS?", kind: "from", storeId: a.homeStoreId }
        : undefined;

  // 1) ca có lịch → đã làm (khớp giờ với lượt chấm công tại cơ sở này) / bỏ ca / chưa tới
  for (const s of input.assignments) {
    const w = win(s.date, s.startTime, s.endTime, tz);
    const mine = input.attendances
      .filter((a) => a.userId === s.userId && a.storeId === storeId && overlap(attWin(a), w) > 0)
      .sort((x, y) => x.checkInAt.getTime() - y.checkInAt.getTime());
    mine.forEach((a) => used.add(a.id));
    const a0 = mine[0];
    const aN = mine[mine.length - 1];
    // đi muộn: lượt có giờ vào nằm trong / trước ca này; về sớm: lượt có giờ ra nằm trong ca này
    const lateHere = a0 && a0.checkInAt.getTime() >= w[0] - 3 * 3600_000 && a0.checkInAt.getTime() < w[1] ? a0.lateMinutes || 0 : 0;
    const outT = aN?.checkOutAt?.getTime();
    const earlyHere = aN && outT != null && outT > w[0] && outT <= w[1] ? aN.earlyMinutes || 0 : 0;
    push(s.date, s.tplId, {
      key: `s:${s.id}`,
      userId: s.userId,
      name: names[s.userId] ?? "?",
      linkStoreId: homeOf[s.userId] ?? storeId,
      state: mine.length ? "worked" : w[1] < input.now.getTime() ? "missed" : "upcoming",
      late: lateHere || undefined,
      early: earlyHere || undefined,
      missingOut: mine.some((a) => a.status === "MISSING_CHECKOUT") || undefined,
      tag: a0 ? tagFor(a0) : homeOf[s.userId] && homeOf[s.userId] !== storeId ? { label: storeTag[homeOf[s.userId]] ?? "CS?", kind: "from", storeId: homeOf[s.userId] } : undefined,
    });
  }

  for (const s of input.pending ?? [])
    push(s.date, s.tplId, { key: `p:${s.id}`, userId: s.userId, name: names[s.userId] ?? "?", linkStoreId: homeOf[s.userId] ?? storeId, state: "pending" });

  // 2) lượt chấm công không khớp ca có lịch ở đây: làm thêm ca / đi hỗ trợ nơi khác → xếp vào hàng ca gần giờ nhất
  for (const a of input.attendances) {
    if (used.has(a.id) || !days.includes(a.workDate)) continue;
    const aw = attWin(a);
    let best: BoardTpl | undefined;
    let bestScore = -Infinity;
    for (const t of templates) {
      const w = win(a.workDate, t.startTime, t.endTime, tz);
      const score = overlap(aw, w) || -Math.abs(aw[0] - w[0]) / 1000; // ưu tiên chồng giờ, sau đó gần giờ bắt đầu
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    if (!best) continue;
    push(a.workDate, best.id, {
      key: `a:${a.id}`,
      userId: a.userId,
      name: names[a.userId] ?? "?",
      linkStoreId: a.homeStoreId,
      state: "worked",
      late: a.lateMinutes || undefined,
      early: a.earlyMinutes || undefined,
      extra: a.storeId === storeId && (a.outOfShift ?? true) ? true : undefined,
      missingOut: a.status === "MISSING_CHECKOUT" || undefined,
      tag: tagFor(a),
    });
  }
  for (const k of Object.keys(cells)) cells[k].sort((x, y) => Number(x.state === "missed") - Number(y.state === "missed") || x.name.localeCompare(y.name));
  const rowsPerTpl = Object.fromEntries(
    templates.map((t) => [t.id, Math.max(input.minRows ?? 2, ...days.map((d) => cells[`${d}|${t.id}`]?.length ?? 0))]),
  ) as Record<string, number>;
  return { cells, rowsPerTpl };
}
