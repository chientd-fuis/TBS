import { connectDB } from "./db";
import { ShiftRegLog } from "./models";
import { weekStartOf } from "./time";

/*
 * LỊCH SỬ ĐĂNG KÝ CA (Xếp ca → Lịch sử đăng ký tuần này): ghi mỗi lần nhân viên gửi / sửa đăng ký,
 * admin duyệt / từ chối / xếp / bỏ khỏi ca – để sau khi từ chối vẫn biết nhân viên từng đăng ký những ca nào.
 * Tự xoá sau 14 ngày (TTL ở models.ts). Ghi lỗi không được làm hỏng thao tác chính → nuốt lỗi.
 */

export type RegKind = "SUBMIT" | "APPROVE" | "REJECT" | "ASSIGN" | "REMOVE";
export type RegItem = { date: string; tplId: string; name?: string | null };

type Ev = { storeId: unknown; userId: unknown; kind: RegKind; by: string; byStaff?: boolean; add?: RegItem[]; remove?: RegItem[] };

/** Ghi lịch sử – tự tách theo nhân viên × tuần. */
export async function logShiftReg(ev: Ev | Ev[]) {
  try {
    await connectDB();
    const docs = [];
    for (const e of Array.isArray(ev) ? ev : [ev]) {
      const groups = new Map<string, { add: RegItem[]; remove: RegItem[] }>();
      const put = (it: RegItem, k: "add" | "remove") => {
        const w = weekStartOf(it.date);
        if (!groups.has(w)) groups.set(w, { add: [], remove: [] });
        groups.get(w)![k].push({ date: it.date, tplId: String(it.tplId), name: it.name ?? "" });
      };
      (e.add ?? []).forEach((i) => put(i, "add"));
      (e.remove ?? []).forEach((i) => put(i, "remove"));
      for (const [weekStart, g] of groups)
        docs.push({
          storeId: e.storeId,
          userId: e.userId,
          weekStart,
          kind: e.kind,
          by: e.by,
          byStaff: !!e.byStaff,
          ...(g.add.length ? { add: g.add } : {}),
          ...(g.remove.length ? { remove: g.remove } : {}),
        });
    }
    if (docs.length) await ShiftRegLog.insertMany(docs);
  } catch (e) {
    console.error("[shift-reg-log]", (e as Error).message);
  }
}

/** Gom danh sách ca (có userId) theo nhân viên → nhiều sự kiện cùng loại. */
export function byUser(storeId: unknown, kind: RegKind, by: string, list: { userId: unknown; date: string; shiftTemplateId?: unknown; tplId?: unknown; shiftName?: string | null }[]): Ev[] {
  const m = new Map<string, RegItem[]>();
  for (const a of list) {
    const k = String(a.userId);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push({ date: a.date, tplId: String(a.shiftTemplateId ?? a.tplId), name: a.shiftName });
  }
  return [...m].map(([userId, items]) => ({ storeId, userId, kind, by, ...(kind === "REMOVE" ? { remove: items } : { add: items }) }));
}

export type RegLogView = {
  id: string;
  userId: string;
  kind: RegKind;
  by: string;
  byStaff: boolean;
  at: number;
  add: { date: string; tplId: string }[];
  remove: { date: string; tplId: string }[];
};

/** Lịch sử 1 tuần của 1 cơ sở (mới nhất trước) – dạng thuần để truyền cho client. */
export async function loadRegLogs(storeId: string, weekStart: string): Promise<RegLogView[]> {
  await connectDB();
  const rows = await ShiftRegLog.find({ storeId, weekStart }).sort({ at: -1 }).limit(500).lean();
  return rows.map((r) => ({
    id: String(r._id),
    userId: String(r.userId),
    kind: r.kind as RegKind,
    by: r.by ?? "",
    byStaff: !!r.byStaff,
    at: r.at ? new Date(r.at).getTime() : 0,
    add: ((r.add ?? []) as RegItem[]).map((x) => ({ date: x.date ?? "", tplId: x.tplId ?? "" })),
    remove: ((r.remove ?? []) as RegItem[]).map((x) => ({ date: x.date ?? "", tplId: x.tplId ?? "" })),
  }));
}
