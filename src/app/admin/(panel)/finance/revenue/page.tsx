import Link from "next/link";
import { requirePerm } from "@/lib/guards";
import { connectDB } from "@/lib/db";
import { Store } from "@/lib/models";
import { loadDailyRevenueRows } from "@/lib/daily-revenue-rows";
import { localDate, localMonth, monthRange } from "@/lib/time";
import { MonthPicker } from "@/components/MonthPicker";
import { Badge, Card, Field, Input, Select } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import {
  deleteCashTransfer,
  saveCashTransfer,
} from "@/app/admin/actions/finance";
import { cn } from "@/lib/format";
import DailyRevenueTable, { type DayRow } from "./DailyRevenueTable";

export const dynamic = "force-dynamic";
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");

/**
 * Doanh thu theo ngày = số chốt ca TỐI (chốt ca là luỹ kế: Chiều gồm Sáng, Tối = cả ngày).
 * Chưa chốt Tối → tạm tính theo ca chốt gần nhất. Bấm dòng → chi tiết 3 ca.
 */
export default async function DailyRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; store?: string }>;
}) {
  const admin = await requirePerm("finance.revenue"); // Admin Tổng hoặc admin được cấp quyền XEM
  await connectDB();
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "")
    ? sp.month!
    : localMonth(new Date());
  const { last } = monthRange(month);
  const stores = await Store.find({ active: { $ne: false } })
    .sort({ createdAt: 1 })
    .lean();
  const shown = sp.store
    ? stores.filter((s) => String(s._id) === sp.store)
    : stores;
  const owner = admin.kind === "OWNER";
  // dòng bảng dùng chung với menu Doanh thu (lib/daily-revenue-rows) → 2 nơi luôn khớp số
  const { rows, transfers, nameOf } = await loadDailyRevenueRows({ month, stores, shown, owner });
  const net = (t: { kind: string; amount: number }) =>
    t.kind === "DEPOSIT" ? t.amount : -t.amount; // TK tăng bao nhiêu

  // tổng hợp theo cơ sở
  const sumOf = (rs: DayRow[]) => ({
    thu: rs.reduce((s, r) => s + r.thu, 0),
    tk: rs.reduce((s, r) => s + r.tk, 0),
    tm: rs.reduce((s, r) => s + r.tm, 0),
    sg: rs.reduce((s, r) => s + r.sg, 0),
    ket: rs.reduce((s, r) => s + r.ket, 0),
    dtm: rs.reduce((s, r) => s + (r.dtm ?? 0), 0),
    diff: rs.reduce((s, r) => s + (r.diff ?? 0), 0),
    days: rs.length,
    open: rs.filter((r) => !r.final).length,
  });
  // phiếu chưa có dòng ngày (ngày đó chưa chốt ca) → vẫn cộng vào thẻ tổng cho admin xem
  const moves = (sid?: string) => {
    const list = transfers.filter((t) => !sid || String(t.storeId) === sid);
    const unplaced = owner
      ? []
      : list.filter(
          (t) =>
            !rows.some(
              (x) => x.date === t.date && x.storeId === String(t.storeId),
            ),
        );
    return {
      deposit: list
        .filter((t) => t.kind === "DEPOSIT")
        .reduce((s, t) => s + t.amount, 0),
      withdraw: list
        .filter((t) => t.kind === "WITHDRAW")
        .reduce((s, t) => s + t.amount, 0),
      extra: unplaced.reduce((s, t) => s + net(t), 0),
    };
  };
  const card = (name: string, rs: DayRow[], m: ReturnType<typeof moves>) => {
    const x = sumOf(rs);
    return {
      name,
      ...x,
      tk: x.tk + m.extra,
      tm: x.tm - m.extra,
      deposit: m.deposit,
      withdraw: m.withdraw,
    };
  };
  const cards = [
    ...shown.map((s) =>
      card(
        s.name,
        rows.filter((r) => r.storeId === String(s._id)),
        moves(String(s._id)),
      ),
    ),
    ...(shown.length > 1 ? [card("Cả chuỗi", rows, moves())] : []),
  ];
  const today = localDate(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthPicker
          month={month}
          base="/admin/finance/revenue"
          params={{ store: sp.store }}
        />
        <div className="flex flex-wrap gap-1.5 text-sm">
          {[
            { id: "", name: "Tất cả" },
            ...stores.map((s) => ({
              id: String(s._id),
              name: s.name.replace(/^TBS\s*/i, ""),
            })),
          ].map((s) => (
            <Link
              key={s.id || "all"}
              href={`/admin/finance/revenue?month=${month}${s.id ? `&store=${s.id}` : ""}`}
              className={cn(
                "rounded-lg px-3 py-1.5",
                (sp.store ?? "") === s.id
                  ? "bg-secondary font-bold text-white"
                  : "bg-white text-ink/70 ring-1 ring-[#f1e6c8] hover:bg-primary-light",
              )}
            >
              {s.name}
            </Link>
          ))}
        </div>
      </div>

      <div
        className={cn(
          "grid gap-3",
          cards.length > 2 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2",
        )}
      >
        {cards.map((c) => (
          <Card
            key={c.name}
            className={cn(
              "p-3",
              c.name === "Cả chuỗi" && "ring-2 ring-secondary/40",
            )}
          >
            <p className="text-sm font-bold text-accent">{c.name}</p>
            <p className="mt-1 text-xs text-ink/60">Tổng doanh thu thật</p>
            <p className="text-xl font-bold tabular-nums">{vnd(c.thu)}</p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
              <dt className="text-ink/60">Tài khoản</dt>
              <dd className="text-right tabular-nums">{vnd(c.tk)}</dd>
              <dt className="text-ink/60">Tiền mặt</dt>
              <dd className="text-right tabular-nums">{vnd(c.tm)}</dd>
              {owner && (c.deposit > 0 || c.withdraw > 0) && (
                <>
                  <dt className="pl-2 text-xs text-ink/60">
                    Nộp TM → TK / Rút TK → TM
                  </dt>
                  <dd className="text-right text-xs tabular-nums text-ink/60">
                    {vnd(c.deposit)} / {vnd(c.withdraw)}
                  </dd>
                  <dt className="pl-2 text-xs font-semibold text-[#1e40af]">
                    TK sau chuyển
                  </dt>
                  <dd className="text-right text-xs font-semibold tabular-nums text-[#1e40af]">
                    {vnd(c.tk + c.deposit - c.withdraw)}
                  </dd>
                  <dt className="pl-2 text-xs font-semibold text-[#1e40af]">
                    TM sau chuyển
                  </dt>
                  <dd className="text-right text-xs font-semibold tabular-nums text-[#1e40af]">
                    {vnd(c.tm - c.deposit + c.withdraw)}
                  </dd>
                </>
              )}
              <dt className="text-ink/60">Shopee / Grab</dt>
              <dd className="text-right tabular-nums">{vnd(c.sg)}</dd>
              <dt className="text-ink/60">Chi phí két</dt>
              <dd className="text-right tabular-nums text-ink/60">
                {vnd(c.ket)}
              </dd>
              <dt className="text-ink/60">DT máy</dt>
              <dd className="text-right tabular-nums">{vnd(c.dtm)}</dd>
              <dt className="text-ink/60">Âm / Dương</dt>
              <dd
                className={cn(
                  "text-right font-semibold tabular-nums",
                  c.diff ? "text-danger" : "text-secondary-dark",
                )}
              >
                {c.diff > 0 ? "+" : ""}
                {vnd(c.diff)}
              </dd>
            </dl>
            <p className="mt-1 text-[11px] text-ink/50">
              {c.days} ngày có chốt ca
              {c.open ? ` · ${c.open} ngày chưa chốt Tối` : ""}
            </p>
          </Card>
        ))}
      </div>

      {owner && (
        <Card
          title={`Sổ quỹ tiền mặt / tài khoản – tháng ${month.slice(5)}/${month.slice(0, 4)}`}
        >
          <ActionForm
            action={saveCashTransfer}
            submitLabel="Ghi phiếu"
            successText="Đã ghi"
            className="space-y-2"
          >
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-[10rem_15rem_10rem_9rem_1fr] lg:items-end">
              <Field label="Cơ sở">
                <Select
                  name="storeId"
                  defaultValue={sp.store || String(stores[0]?._id ?? "")}
                >
                  {stores.map((s) => (
                    <option key={String(s._id)} value={String(s._id)}>
                      {s.name.replace(/^TBS\s*/i, "")}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Loại">
                <Select name="kind" defaultValue="DEPOSIT">
                  <option value="DEPOSIT">Nộp tiền mặt vào tài khoản</option>
                  <option value="WITHDRAW">Rút tài khoản ra tiền mặt</option>
                </Select>
              </Field>
              <Field label="Ngày">
                <Input
                  type="date"
                  name="date"
                  defaultValue={today.startsWith(month) ? today : last}
                  required
                />
              </Field>
              <Field label="Số tiền">
                <Input
                  name="amount"
                  inputMode="numeric"
                  required
                  placeholder="5tr / 5000000"
                  className="text-right"
                />
              </Field>
              <div className="col-span-2 lg:col-span-1">
                <Field label="Ghi chú">
                  <Input name="note" placeholder="Tuỳ chọn" />
                </Field>
              </div>
            </div>
          </ActionForm>
          {transfers.length > 0 && (
            <ul className="mt-3 divide-y divide-[#f1e6c8] text-sm">
              {transfers.map((t) => (
                <li
                  key={String(t._id)}
                  className="flex flex-wrap items-center gap-2 py-1.5"
                >
                  <span className="w-16 tabular-nums">
                    {t.date.slice(8)}/{t.date.slice(5, 7)}
                  </span>
                  <span className="w-20 text-xs text-ink/60">
                    {nameOf.get(String(t.storeId))}
                  </span>
                  <Badge tone={t.kind === "DEPOSIT" ? "blue" : "yellow"}>
                    {t.kind === "DEPOSIT" ? "TM → TK" : "TK → TM"}
                  </Badge>
                  <b className="tabular-nums">{vnd(t.amount)}</b>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink/60">
                    {t.note}
                  </span>
                  <ActionForm
                    action={deleteCashTransfer}
                    submitLabel="Xoá"
                    variant="ghost"
                    successText=""
                    confirm={`Xoá phiếu ${vnd(t.amount)} ngày ${t.date.slice(8)}/${t.date.slice(5, 7)}?`}
                  >
                    <input type="hidden" name="id" value={String(t._id)} />
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <p className="mb-3 text-xs text-ink/60">
          Chốt ca là số <b>luỹ kế</b>: ca Chiều đã gồm ca Sáng, ca Tối = cả
          ngày. Doanh thu thật = TK + TM + Shopee/Grab + Két; Âm/Dương = DT máy
          − DT thật. Doanh thu ngày = số chốt ca <b>Tối</b> (chưa chốt Tối → tạm
          tính theo ca chốt gần nhất). Bấm vào dòng để xem 3 ca.
          {owner
            ? " Bảng là số ban đầu theo chốt ca (chưa tính phiếu nộp / rút)."
            : ""}
        </p>
        <DailyRevenueTable
          rows={rows}
          today={today}
          canEdit={admin.kind === "OWNER"}
        />
      </Card>
    </div>
  );
}
