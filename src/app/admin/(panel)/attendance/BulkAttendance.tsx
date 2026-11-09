"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  ImageUp,
  Loader2,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { normalizeTime } from "@/components/TimeInput";
import {
  expandBulk,
  matchStaff,
  type ImportSession,
} from "@/lib/attendance-import";
import { bulkAttendance, type BulkResult } from "../../actions/ops";

type Staff = { id: string; name: string };
type Tpl = { id: string; name: string; startTime: string; endTime: string };
type Group = { key: string; label: string; userId: string };
type Row = ImportSession & {
  key: string;
  g: string;
  include: boolean;
  check?: BulkResult;
};
type Tab = "one" | "bulk" | "excel" | "ai";

const WD = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const CHUNK = 40;
const pad = (n: number) => String(n).padStart(2, "0");
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;
const wdOf = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = T2
let seq = 0;
const nk = () => `k${++seq}`;

function daysIn(month: string) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

async function fileToJpeg(file: File, maxSide = 2400): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error(`Không đọc được ảnh ${file.name}`));
      i.src = url;
    });
    const scale = Math.min(
      1,
      maxSide / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function TimeBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [raw, setRaw] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setRaw(value);
  }
  const bad = normalizeTime(raw) === null;
  return (
    <span className="inline-block w-[4.6rem] align-middle">
      <Input
        inputMode="numeric"
        value={raw}
        placeholder={placeholder}
        className={`px-2 py-1 text-center tabular-nums ${bad ? "border-danger" : ""}`}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          const n = normalizeTime(raw);
          if (n !== null) {
            setRaw(n);
            onChange(n);
          }
        }}
      />
    </span>
  );
}

/** Chấm công hộ: 1 lượt · nhiều ngày (theo ca / tự nhập giờ) · import Excel · AI đọc ảnh. */
export default function BulkAttendance({
  single,
  staff,
  templates,
  storeId,
  month,
  ocrEnabled,
}: {
  single: ReactNode;
  staff: Staff[];
  templates: Tpl[];
  storeId: string;
  month: string;
  ocrEnabled: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("one");
  const [groups, setGroups] = useState<Group[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"" | "read" | "check" | "save">("");
  const [msg, setMsg] = useState<{
    tone: "green" | "orange" | "red";
    text: string;
  } | null>(null);
  const [progress, setProgress] = useState("");

  // ----- tab Nhiều ngày -----
  const [bMonth, setBMonth] = useState(month);
  const [bUsers, setBUsers] = useState<string[]>([]);
  const [bDays, setBDays] = useState<string[]>([]);
  const [bMode, setBMode] = useState<"shift" | "time">("shift");
  const [bShifts, setBShifts] = useState<string[]>(
    templates[0] ? [templates[0].id] : [],
  );
  const [bIn, setBIn] = useState("08:00");
  const [bOut, setBOut] = useState("");
  // ----- import / AI -----
  const xlsRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const [aiFiles, setAiFiles] = useState<
    {
      name: string;
      state: "wait" | "ok" | "error";
      error?: string;
      n?: number;
    }[]
  >([]);

  const staffName = useMemo(
    () => new Map(staff.map((s) => [s.id, s.name])),
    [staff],
  );
  const userOf = (g: string) => groups.find((x) => x.key === g)?.userId ?? "";
  const reset = () => {
    setRows([]);
    setGroups([]);
    setMsg(null);
    setProgress("");
  };
  const load = (gs: Group[], rs: Row[], why: string) => {
    setGroups(gs);
    setRows(rs);
    setReason(why);
    setMsg(rs.length ? null : { tone: "orange", text: "Không có lượt nào" });
    if (rs.length) void check(rs, gs);
  };

  // ===== kiểm tra / ghi =====
  const payload = (rs: Row[], gs: Group[]) =>
    rs
      .filter((r) => r.include && r.check?.status !== "created")
      .map((r) => ({
        k: r.key,
        userId: gs.find((g) => g.key === r.g)?.userId ?? "",
        date: r.date,
        inTime: r.inTime,
        outTime: r.outTime || null,
      }))
      .filter((r) => r.userId);
  async function run(rs: Row[], gs: Group[], dryRun: boolean) {
    const items = payload(rs, gs);
    const out: BulkResult[] = [];
    for (let i = 0; i < items.length; i += CHUNK) {
      if (!dryRun)
        setProgress(
          `Đang ghi ${Math.min(i + CHUNK, items.length)}/${items.length}…`,
        );
      const r = await bulkAttendance({
        rows: items.slice(i, i + CHUNK),
        reason,
        dryRun,
      });
      if (r.error) throw new Error(r.error);
      out.push(...(r.results ?? []));
    }
    return out;
  }
  async function check(rs = rows, gs = groups) {
    setBusy("check");
    try {
      const res = new Map((await run(rs, gs, true)).map((x) => [x.k, x]));
      setRows(
        rs.map((r) =>
          res.has(r.key)
            ? {
                ...r,
                check: res.get(r.key),
                include: res.get(r.key)!.status === "ok" ? r.include : false,
              }
            : r,
        ),
      );
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  }
  async function save() {
    if (reason.trim().length < 3)
      return setMsg({ tone: "red", text: "Nhập lý do chấm hộ" });
    setBusy("save");
    setMsg(null);
    try {
      const res = new Map(
        (await run(rows, groups, false)).map((x) => [x.k, x]),
      );
      const next = rows.map((r) =>
        res.has(r.key)
          ? {
              ...r,
              check: res.get(r.key),
              include: res.get(r.key)!.status === "created" ? false : r.include,
            }
          : r,
      );
      setRows(next);
      const n = (s: string) =>
        [...res.values()].filter((x) => x.status === s).length;
      setMsg({
        tone: n("error") ? "orange" : "green",
        text: `Đã ghi ${n("created")} lượt${n("dup") ? ` · bỏ qua ${n("dup")} lượt trùng` : ""}${n("error") ? ` · ${n("error")} lượt lỗi (xem cột Ghi chú)` : ""}.`,
      });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
      setProgress("");
    }
  }

  // ===== tạo danh sách =====
  function buildBulk() {
    if (!bUsers.length) return setMsg({ tone: "red", text: "Chọn nhân viên" });
    if (!bDays.length) return setMsg({ tone: "red", text: "Chọn ngày" });
    const shifts =
      bMode === "shift"
        ? templates.filter((t) => bShifts.includes(t.id))
        : undefined;
    if (bMode === "shift" && !shifts?.length)
      return setMsg({ tone: "red", text: "Chọn ít nhất 1 ca" });
    if (bMode === "time" && !normalizeTime(bIn))
      return setMsg({ tone: "red", text: "Nhập giờ vào" });
    const sessions = expandBulk({
      dates: bDays,
      shifts,
      inTime: bIn,
      outTime: bOut,
    });
    const gs = bUsers.map((u) => ({
      key: `u:${u}`,
      label: staffName.get(u) ?? "",
      userId: u,
    }));
    load(
      gs,
      gs.flatMap((g) =>
        sessions.map((s) => ({ ...s, key: nk(), g: g.key, include: true })),
      ),
      bMode === "shift" ? "Chấm hộ hàng loạt theo ca" : "Chấm hộ hàng loạt",
    );
  }

  async function readExcel(f: File) {
    setBusy("read");
    reset();
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/admin/attendance/import", {
        method: "POST",
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Không đọc được file");
      const all = j.sheets as {
        sheet: string;
        name: string;
        sessions: ImportSession[];
      }[];
      // chỉ lấy lượt của tháng đang chọn – các ngày khác trong file bỏ qua
      let skipped = 0;
      const sheets = all
        .map((s) => {
          const inMonth = s.sessions.filter((x) => x.date.startsWith(bMonth));
          skipped += s.sessions.length - inMonth.length;
          return { ...s, sessions: inMonth };
        })
        .filter((s) => s.sessions.length);
      if (!sheets.length) throw new Error(`File không có lượt chấm công nào trong tháng ${+bMonth.slice(5)}/${bMonth.slice(0, 4)}`);
      const gs: Group[] = sheets.map((s) => ({
        key: `s:${s.sheet}`,
        label: s.name || s.sheet,
        userId: matchStaff(s.name, staff)?.id ?? "",
      }));
      load(
        gs,
        sheets.flatMap((s) =>
          s.sessions.map((x) => ({
            ...x,
            key: nk(),
            g: `s:${s.sheet}`,
            include: true,
          })),
        ),
        `Import Excel ${f.name}`,
      );
      if (skipped) setProgress(`Đã bỏ qua ${skipped} lượt ngoài tháng ${+bMonth.slice(5)}/${bMonth.slice(0, 4)}`);
    } catch (e) {
      setMsg({ tone: "red", text: (e as Error).message });
    } finally {
      setBusy("");
      if (xlsRef.current) xlsRef.current.value = "";
    }
  }

  async function readImages(files: File[]) {
    if (!files.length) return;
    setBusy("read");
    reset();
    setAiFiles(files.map((f) => ({ name: f.name, state: "wait" })));
    const found: (ImportSession & { name: string })[] = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const photo = await fileToJpeg(files[i]);
        const r = await fetch("/api/admin/attendance/ocr", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photo, store: storeId, month: bMonth }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "AI không đọc được ảnh");
        found.push(...j.records);
        setAiFiles((xs) =>
          xs.map((x, k) =>
            k === i ? { ...x, state: "ok", n: j.records.length } : x,
          ),
        );
      } catch (e) {
        setAiFiles((xs) =>
          xs.map((x, k) =>
            k === i ? { ...x, state: "error", error: (e as Error).message } : x,
          ),
        );
      }
    }
    const names = [...new Set(found.map((f) => f.name))];
    const gs: Group[] = names.map((n) => ({
      key: `n:${n}`,
      label: n || "Không rõ tên",
      userId: matchStaff(n, staff)?.id ?? "",
    }));
    setBusy("");
    if (imgRef.current) imgRef.current.value = "";
    if (found.length)
      load(
        gs,
        found.map(({ name, ...s }) => ({
          ...s,
          key: nk(),
          g: `n:${name}`,
          include: true,
        })),
        "AI đọc ảnh bảng chấm công",
      );
    else
      setMsg({
        tone: "orange",
        text: "AI không tìm thấy lượt chấm công nào trong ảnh",
      });
  }

  // ===== giao diện =====
  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key
          ? {
              ...r,
              ...p,
              ...("date" in p || "inTime" in p || "outTime" in p
                ? { check: undefined }
                : {}),
            }
          : r,
      ),
    );
  const setGroupUser = (key: string, userId: string) => {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, userId } : g)));
    setRows((rs) =>
      rs.map((r) =>
        r.g === key ? { ...r, check: undefined, include: !!userId } : r,
      ),
    );
  };
  const chosen = rows.filter(
    (r) => r.include && userOf(r.g) && r.check?.status !== "created",
  );
  const unchecked = chosen.some((r) => !r.check);
  const days = daysIn(bMonth);
  const tabBtn = (t: Tab, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(t);
        if (t === "one") reset();
      }}
      className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-secondary text-white" : "bg-cream text-ink/70 hover:bg-primary-light"}`}
    >
      {icon}
      {label}
    </button>
  );
  const chip = (
    on: boolean,
    label: string,
    onClick: () => void,
    key: string,
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-secondary bg-secondary text-white" : "border-ink/15 bg-white text-ink/80"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabBtn("one", null, "Một lượt")}
        {tabBtn("bulk", <CalendarDays size={15} />, "Nhiều ngày")}
        {tabBtn("excel", <FileSpreadsheet size={15} />, "Import Excel")}
        {tabBtn("ai", <Sparkles size={15} />, "Đọc ảnh (AI)")}
      </div>

      {tab === "one" && single}

      {tab === "bulk" && (
        <div className="space-y-3">
          <Field label="Nhân viên (chọn 1 hoặc nhiều)">
            <div className="flex flex-wrap gap-1.5">
              {staff.map((s) =>
                chip(
                  bUsers.includes(s.id),
                  s.name,
                  () =>
                    setBUsers((u) =>
                      u.includes(s.id)
                        ? u.filter((x) => x !== s.id)
                        : [...u, s.id],
                    ),
                  s.id,
                ),
              )}
            </div>
          </Field>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Ngày</span>
              <span className="w-40">
                <Input
                  type="month"
                  value={bMonth}
                  onChange={(e) => (setBMonth(e.target.value), setBDays([]))}
                  className="py-1"
                />
              </span>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setBDays(days)}
              >
                Cả tháng
              </button>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setBDays(days.filter((d) => wdOf(d) < 5))}
              >
                T2–T6
              </button>
              <button
                type="button"
                className="text-xs text-accent underline"
                onClick={() => setBDays([])}
              >
                Bỏ chọn
              </button>
              <span className="text-xs text-ink/60">
                Đã chọn {bDays.length} ngày
              </span>
            </div>
            <div className="grid max-w-sm grid-cols-7 gap-1 text-center text-sm">
              {WD.map((w, i) => (
                <button
                  key={w}
                  type="button"
                  className="text-xs font-semibold text-ink/50 hover:text-accent"
                  title="Chọn / bỏ cả cột"
                  onClick={() => {
                    const col = days.filter((d) => wdOf(d) === i);
                    const all = col.every((d) => bDays.includes(d));
                    setBDays((x) =>
                      all
                        ? x.filter((d) => !col.includes(d))
                        : [...new Set([...x, ...col])],
                    );
                  }}
                >
                  {w}
                </button>
              ))}
              {Array.from({ length: wdOf(days[0]) }, (_, i) => (
                <span key={`e${i}`} />
              ))}
              {days.map((d) => {
                const on = bDays.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() =>
                      setBDays((x) =>
                        on ? x.filter((y) => y !== d) : [...x, d],
                      )
                    }
                    className={`rounded-lg py-1.5 tabular-nums ${on ? "bg-secondary font-bold text-white" : "bg-cream hover:bg-primary-light"}`}
                  >
                    {+d.slice(8)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  className="accent-[#3c9c54]"
                  checked={bMode === "shift"}
                  onChange={() => setBMode("shift")}
                />{" "}
                Theo ca (lấy giờ của ca)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  className="accent-[#3c9c54]"
                  checked={bMode === "time"}
                  onChange={() => setBMode("time")}
                />{" "}
                Tự nhập giờ vào / ra
              </label>
            </div>
            {bMode === "shift" ? (
              templates.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((t) =>
                    chip(
                      bShifts.includes(t.id),
                      `${t.name} ${t.startTime}–${t.endTime}`,
                      () =>
                        setBShifts((x) =>
                          x.includes(t.id)
                            ? x.filter((y) => y !== t.id)
                            : [...x, t.id],
                        ),
                      t.id,
                    ),
                  )}
                </div>
              ) : (
                <p className="text-sm text-warn">
                  Cơ sở chưa có ca mẫu – dùng “Tự nhập giờ”.
                </p>
              )
            ) : (
              <div className="flex items-center gap-2 text-sm">
                Vào <TimeBox value={bIn} onChange={setBIn} /> Ra{" "}
                <TimeBox value={bOut} onChange={setBOut} placeholder="trống" />
              </div>
            )}
          </div>
          <Button type="button" variant="outline" onClick={buildBulk}>
            <CalendarDays size={16} /> Tạo danh sách{" "}
            {bUsers.length && bDays.length
              ? `(${bUsers.length} NV × ${bDays.length} ngày)`
              : ""}
          </Button>
        </div>
      )}

      {tab === "excel" && (
        <div className="space-y-2 text-sm">
          <p className="text-xs text-ink/70">
            File .xlsx, mỗi nhân viên 1 sheet. Đọc được 2 mẫu: <b>(1)</b> cột{" "}
            <b>Ngày | Thời gian | Hình thức chấm công | … | Ca làm việc</b> (mỗi
            lượt 2 dòng vào/ra – file IN_OUT của máy chấm công cũ);{" "}
            <b>(2)</b> mỗi dòng 1 lượt <b>Ngày | Giờ Đến | Giờ Về</b> (tên sheet
            = tên nhân viên, VD Le_Thi_Nga – Google Sheet tải về dạng .xlsx).
            Chỉ lấy các ngày thuộc tháng chọn bên dưới. Đọc xong bạn chọn lại
            nhân viên cho từng sheet trước khi ghi.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Chỉ lấy tháng</span>
            <span className="w-40">
              <Input type="month" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="py-1" />
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#e9d9a8] bg-white px-3 py-2 font-semibold"
              href={`/api/admin/attendance/import?store=${storeId}&month=${bMonth}`}
            >
              <Download size={16} /> Tải file mẫu T{+bMonth.slice(5)}
            </a>
            <Button
              type="button"
              disabled={busy === "read"}
              onClick={() => xlsRef.current?.click()}
            >
              {busy === "read" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <FileSpreadsheet size={16} />
              )}{" "}
              Chọn file Excel
            </Button>
            <input
              ref={xlsRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden
              onChange={(e) =>
                e.target.files?.[0] && readExcel(e.target.files[0])
              }
            />
          </div>
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-2 text-sm">
          {!ocrEnabled ? (
            <Alert tone="yellow">
              Chưa cấu hình GEMINI_API_KEY nên không đọc ảnh được.
            </Alert>
          ) : (
            <>
              <p className="text-xs text-ink/70">
                Tải lên ảnh sổ / bảng chấm công (viết tay, ảnh chụp màn hình
                file Excel / app). AI đọc tên, ngày, giờ vào – ra hoặc ca; thiếu
                giờ thì lấy giờ của ca. Ngày không ghi năm → tính theo tháng{" "}
                <span className="inline-block w-40 align-middle">
                  <Input
                    type="month"
                    value={bMonth}
                    onChange={(e) => setBMonth(e.target.value)}
                    className="py-0.5"
                  />
                </span>
                . Luôn xem lại trước khi ghi.
              </p>
              <Button
                type="button"
                disabled={busy === "read"}
                onClick={() => imgRef.current?.click()}
              >
                {busy === "read" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ImageUp size={16} />
                )}{" "}
                Tải ảnh lên
              </Button>
              <input
                ref={imgRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => readImages([...(e.target.files ?? [])])}
              />
              {!!aiFiles.length && (
                <ul className="space-y-0.5 text-xs">
                  {aiFiles.map((f, i) => (
                    <li
                      key={i}
                      className={
                        f.state === "error" ? "text-danger" : "text-ink/70"
                      }
                    >
                      {f.state === "wait" ? (
                        <Loader2 size={12} className="inline animate-spin" />
                      ) : f.state === "ok" ? (
                        "✓"
                      ) : (
                        "✗"
                      )}{" "}
                      {f.name}
                      {f.state === "ok" && ` – ${f.n} lượt`}
                      {f.error && ` – ${f.error}`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {tab !== "one" && msg && !rows.length && (
        <Alert tone={msg.tone}>{msg.text}</Alert>
      )}

      {/* ===== Xem lại & ghi ===== */}
      {tab !== "one" && rows.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-ink/10 p-3">
          <div className="flex items-center justify-between">
            <b className="text-sm">Xem lại {rows.length} lượt</b>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-ink/60 hover:text-danger"
              onClick={reset}
            >
              <X size={14} /> Huỷ
            </button>
          </div>
          {groups.some((g) => !g.key.startsWith("u:")) && (
            <div className="grid gap-2 sm:grid-cols-2">
              {groups.map((g) => (
                <label
                  key={g.key}
                  className="flex items-center gap-2 rounded-xl bg-cream px-2 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate" title={g.label}>
                    <b>{g.label}</b>{" "}
                    <span className="text-xs text-ink/50">
                      ({rows.filter((r) => r.g === g.key).length})
                    </span>{" "}
                    →
                  </span>
                  <span className="w-44 shrink-0">
                    <Select
                      value={g.userId}
                      onChange={(e) => setGroupUser(g.key, e.target.value)}
                      className={`py-1 ${g.userId ? "" : "border-warn"}`}
                    >
                      <option value="">— Bỏ qua —</option>
                      {staff.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="max-h-[28rem] overflow-auto">
            <table className="tbs text-sm">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      className="accent-[#3c9c54]"
                      checked={rows.every(
                        (r) =>
                          r.include ||
                          r.check?.status === "created" ||
                          !userOf(r.g),
                      )}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((r) =>
                            r.check?.status === "created" || !userOf(r.g)
                              ? r
                              : { ...r, include: e.target.checked },
                          ),
                        )
                      }
                    />
                  </th>
                  <th>Nhân viên</th>
                  <th>Ngày</th>
                  <th>Vào</th>
                  <th>Ra</th>
                  <th>Ca</th>
                  <th>Ghi chú</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const uid = userOf(r.g);
                  const done = r.check?.status === "created";
                  const st = r.check?.status;
                  return (
                    <tr
                      key={r.key}
                      className={
                        done
                          ? "bg-[#e9f6ec]"
                          : !r.include
                            ? "opacity-50"
                            : r.warn
                              ? "bg-[#fff6e5]"
                              : ""
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="accent-[#3c9c54]"
                          disabled={done || !uid}
                          checked={r.include && !!uid}
                          onChange={(e) =>
                            patch(r.key, { include: e.target.checked })
                          }
                        />
                      </td>
                      <td className="whitespace-nowrap">
                        {uid ? (
                          staffName.get(uid)
                        ) : (
                          <span className="text-warn">chưa chọn</span>
                        )}
                      </td>
                      <td>
                        <span className="block w-[8.5rem]">
                          <Input
                            type="date"
                            value={r.date}
                            disabled={done}
                            onChange={(e) =>
                              patch(r.key, { date: e.target.value })
                            }
                            className="px-1 py-1"
                            title={`${wdOf(r.date) === 6 ? "CN" : `T${wdOf(r.date) + 2}`} ${dm(r.date)}`}
                          />
                        </span>
                      </td>
                      <td>
                        <TimeBox
                          value={r.inTime}
                          onChange={(v) => patch(r.key, { inTime: v })}
                        />
                      </td>
                      <td>
                        <TimeBox
                          value={r.outTime ?? ""}
                          onChange={(v) => patch(r.key, { outTime: v || null })}
                          placeholder="trống"
                        />
                      </td>
                      <td className="whitespace-nowrap text-xs">{r.shift}</td>
                      <td className="min-w-[9rem] text-xs">
                        {done ? (
                          <span className="font-semibold text-secondary-dark">
                            ✓ Đã ghi
                          </span>
                        ) : st === "dup" || st === "error" ? (
                          <span
                            className={
                              st === "dup" ? "text-ink/60" : "text-danger"
                            }
                          >
                            {r.check?.msg}
                          </span>
                        ) : (
                          <>
                            {r.warn && (
                              <span className="text-warn">{r.warn}</span>
                            )}
                            {st === "ok" && !r.warn && (
                              <span className="text-secondary-dark">OK</span>
                            )}
                          </>
                        )}
                      </td>
                      <td>
                        {!done && (
                          <button
                            type="button"
                            className="text-ink/40 hover:text-danger"
                            onClick={() =>
                              setRows((rs) => rs.filter((x) => x.key !== r.key))
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Field label="Lý do (bắt buộc)">
            <Textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!!busy || !chosen.length}
              onClick={() => check()}
            >
              {busy === "check" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ShieldCheck size={16} />
              )}{" "}
              Kiểm tra trùng
            </Button>
            <Button
              type="button"
              disabled={!!busy || !chosen.length}
              onClick={save}
            >
              {busy === "save" ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Send size={16} />
              )}{" "}
              Ghi nhận {chosen.length} lượt
            </Button>
            {progress && (
              <span className="text-xs text-ink/60">{progress}</span>
            )}
            {!busy && unchecked && (
              <span className="text-xs text-ink/60">
                Có lượt đã sửa – bấm Kiểm tra trùng trước khi ghi
              </span>
            )}
            {!busy && !unchecked && chosen.length > 0 && (
              <span className="flex items-center gap-1 text-xs text-secondary-dark">
                <CheckCircle2 size={14} /> Đã kiểm tra
              </span>
            )}
          </div>
          <p className="text-xs text-ink/60">
            Lượt trùng giờ với lượt đã có bị bỏ qua. Giờ công, đi muộn / về sớm
            tự tính lại theo ca đã xếp như chấm hộ bình thường.
          </p>
        </div>
      )}
    </div>
  );
}
