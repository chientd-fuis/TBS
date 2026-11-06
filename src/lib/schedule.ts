/* Xếp ca theo tuần: dữ liệu bảng lịch + thuật toán xếp ca tự động (thuần, có unit test). */

export type TplInfo = {
  id: string;
  name: string;
  startTime: string; // HH:mm
  endTime: string;
  minStaff: number;
  targetStaff: number;
};
export type Entry = {
  id: string;
  userId: string;
  tplId: string;
  date: string; // YYYY-MM-DD
  status: "PENDING" | "APPROVED" | "REJECTED";
  source?: string;
  createdAt?: number;
};
export type AutoOptions = {
  approvePending: boolean; // duyệt các đăng ký đang chờ (tới định mức)
  fillTo: "none" | "min" | "target"; // tự bù người cho ca thiếu
  preferFrequentShift: boolean; // ưu tiên người hay làm ca này
  preferCoworkers: boolean; // ưu tiên người hay làm cùng ca với những người đã có trong ca
  maxShiftsPerWeek: number; // 0 = không giới hạn
  onlyRequested: boolean; // bù thiếu chỉ lấy người đã đăng ký ít nhất 1 ca trong tuần
};
export type History = {
  freq: Record<string, Record<string, number>>; // userId → tplId → số lần
  pair: Record<string, Record<string, number>>; // userId → userId → số lần làm chung ca
};
export type PlanChange =
  | { kind: "approve"; entryId: string; userId: string; tplId: string; date: string; reason: string }
  | { kind: "add"; userId: string; tplId: string; date: string; reason: string };
export type SlotStatus = { date: string; tplId: string; count: number; min: number; target: number; level: "ok" | "low" | "short" };

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Khoảng thời gian tuyệt đối (phút) của 1 ca trong tuần – dùng để tránh xếp trùng giờ. */
export function slotInterval(days: string[], date: string, tpl: { startTime: string; endTime: string }) {
  const d = days.indexOf(date);
  const s = d * 1440 + toMin(tpl.startTime);
  let e = d * 1440 + toMin(tpl.endTime);
  if (e <= s) e += 1440; // qua đêm
  return [s, e] as const;
}

export function slotLevel(count: number, min: number, target: number): SlotStatus["level"] {
  if (min > 0 && count < min) return "short";
  if (target > 0 && count < target) return "low";
  return "ok";
}

/**
 * Lập kế hoạch xếp ca tự động cho 1 tuần.
 * 1) Duyệt đăng ký chờ (tới định mức), ưu tiên người đang có ít ca hơn, đăng ký sớm hơn.
 * 2) Ca còn thiếu → tìm người có ÍT CA NHẤT tuần, không trùng giờ, chưa bị từ chối ca đó;
 *    hoà điểm thì ưu tiên người hay làm ca này / hay làm cùng những người đã có trong ca.
 */
export function planAutoSchedule(input: {
  days: string[];
  templates: TplInfo[];
  staff: { id: string; name: string }[];
  entries: Entry[];
  history: History;
  opts: AutoOptions;
}) {
  const { days, templates, staff, history, opts } = input;
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const changes: PlanChange[] = [];

  // trạng thái làm việc (ca đã duyệt + ca dự kiến duyệt)
  const approved = input.entries.filter((e) => e.status === "APPROVED").map((e) => ({ ...e }));
  const count = new Map<string, number>(staff.map((s) => [s.id, 0]));
  const busy = new Map<string, [number, number][]>();
  const addBusy = (uid: string, date: string, tplId: string) => {
    const t = tplById.get(tplId);
    if (!t) return;
    const list = busy.get(uid) ?? [];
    list.push(slotInterval(days, date, t) as [number, number]);
    busy.set(uid, list);
  };
  for (const e of approved) {
    count.set(e.userId, (count.get(e.userId) ?? 0) + 1);
    addBusy(e.userId, e.date, e.tplId);
  }
  const overlaps = (uid: string, date: string, t: TplInfo) => {
    const [s, e] = slotInterval(days, date, t);
    return (busy.get(uid) ?? []).some(([a, b]) => s < b && a < e);
  };
  const underCap = (uid: string) => !opts.maxShiftsPerWeek || (count.get(uid) ?? 0) < opts.maxShiftsPerWeek;
  const inSlot = (date: string, tplId: string) => approved.filter((e) => e.date === date && e.tplId === tplId).map((e) => e.userId);
  const affinity = (uid: string, tplId: string, crew: string[]) =>
    (opts.preferFrequentShift ? (history.freq[uid]?.[tplId] ?? 0) : 0) +
    (opts.preferCoworkers ? crew.reduce((s, c) => s + (history.pair[uid]?.[c] ?? 0), 0) : 0);
  const take = (uid: string, date: string, tplId: string) => {
    approved.push({ id: "", userId: uid, tplId, date, status: "APPROVED" });
    count.set(uid, (count.get(uid) ?? 0) + 1);
    addBusy(uid, date, tplId);
  };

  const requestedUsers = new Set(input.entries.filter((e) => e.status !== "REJECTED" && e.source === "REQUEST").map((e) => e.userId));
  const rejected = new Set(input.entries.filter((e) => e.status === "REJECTED").map((e) => `${e.userId}|${e.date}|${e.tplId}`));
  const pending = input.entries.filter((e) => e.status === "PENDING");

  for (const date of days) {
    for (const t of templates) {
      // 1) duyệt đăng ký chờ
      if (opts.approvePending) {
        const reqs = pending
          .filter((p) => p.date === date && p.tplId === t.id)
          .sort((a, b) => (count.get(a.userId) ?? 0) - (count.get(b.userId) ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
        for (const r of reqs) {
          const crew = inSlot(date, t.id);
          if (t.targetStaff > 0 && crew.length >= t.targetStaff) break; // đủ định mức → để admin quyết
          if (overlaps(r.userId, date, t) || !underCap(r.userId)) continue;
          take(r.userId, date, t.id);
          changes.push({ kind: "approve", entryId: r.id, userId: r.userId, tplId: t.id, date, reason: "Duyệt đăng ký" });
        }
      }
      // 2) bù người cho ca thiếu
      const goal = opts.fillTo === "target" ? Math.max(t.targetStaff, t.minStaff) : opts.fillTo === "min" ? t.minStaff : 0;
      let crew = inSlot(date, t.id);
      while (crew.length < goal) {
        const pendingHere = new Set(pending.filter((p) => p.date === date && p.tplId === t.id).map((p) => p.userId));
        const cands = staff
          .filter((s) => !crew.includes(s.id) && !pendingHere.has(s.id))
          .filter((s) => !rejected.has(`${s.id}|${date}|${t.id}`))
          .filter((s) => !opts.onlyRequested || requestedUsers.has(s.id))
          .filter((s) => underCap(s.id) && !overlaps(s.id, date, t))
          .map((s) => ({ s, c: count.get(s.id) ?? 0, a: affinity(s.id, t.id, crew) }))
          .sort((x, y) => x.c - y.c || y.a - x.a || x.s.name.localeCompare(y.s.name));
        const pick = cands[0];
        if (!pick) break;
        take(pick.s.id, date, t.id);
        changes.push({
          kind: "add",
          userId: pick.s.id,
          tplId: t.id,
          date,
          reason: `Bù ca thiếu – đang có ${pick.c} ca${pick.a ? `, độ quen ${pick.a}` : ""}`,
        });
        crew = inSlot(date, t.id);
      }
    }
  }

  const slots: SlotStatus[] = [];
  for (const date of days)
    for (const t of templates) {
      const c = inSlot(date, t.id).length;
      slots.push({ date, tplId: t.id, count: c, min: t.minStaff, target: t.targetStaff, level: slotLevel(c, t.minStaff, t.targetStaff) });
    }
  return { changes, slots, shiftCount: Object.fromEntries(count) };
}

/** Tính lịch sử: số lần mỗi người làm từng ca + số lần từng cặp làm chung ca. */
export function buildHistory(rows: { userId: string; tplId: string; date: string }[]): History {
  const freq: History["freq"] = {};
  const pair: History["pair"] = {};
  const slots = new Map<string, string[]>();
  for (const r of rows) {
    (freq[r.userId] ??= {})[r.tplId] = (freq[r.userId][r.tplId] ?? 0) + 1;
    const k = `${r.date}|${r.tplId}`;
    slots.set(k, [...(slots.get(k) ?? []), r.userId]);
  }
  for (const crew of slots.values())
    for (const a of crew)
      for (const b of crew)
        if (a !== b) (pair[a] ??= {})[b] = (pair[a][b] ?? 0) + 1;
  return { freq, pair };
}
