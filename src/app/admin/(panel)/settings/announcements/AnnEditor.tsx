"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ANN_COLORS } from "@/lib/announce-colors";
import { AnnSlide } from "@/components/WhatsNew";
import { saveAnnouncement, setAnnouncementStatus, type AnnInput } from "@/app/admin/actions/announcements";

export type EditAnn = {
  id: string;
  title: string;
  date: string;
  desc: string;
  points: string[];
  color: string;
  image: string;
  ctaHref: string;
  audience: "USER" | "ADMIN" | "ALL";
  storeIds: string[];
  status: string;
  version: number;
};

/** trang để nút "Thử ngay" mở tới */
const CTA_PAGES: [string, string][] = [
  ["", "Không có nút"],
  ["/", "Chấm công (trang chủ)"],
  ["/history", "Lịch sử chấm công"],
  ["/schedule", "Lịch làm / đăng ký ca"],
  ["/payroll", "Bảng lương"],
  ["/receive", "Nhận / Trả hàng"],
  ["/stock", "Tồn kho"],
  ["/closing", "Chốt ca"],
  ["/account", "Tài khoản (đổi giao diện)"],
  ["/assistant", "Trợ lý"],
  ["/help", "Trợ giúp"],
];

/** thu ảnh về JPEG ≤ 900px để lưu gọn trong DB */
function shrink(file: File): Promise<string> {
  return new Promise((ok, fail) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 900 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => fail(new Error("Không đọc được ảnh"));
    img.src = url;
  });
}

const input = "w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-sm";

export default function AnnEditor({
  initial,
  today,
  stores,
  notSeen,
}: {
  initial: EditAnn | null;
  today: string;
  stores: { id: string; name: string }[];
  notSeen: string[];
}) {
  const router = useRouter();
  const [f, setF] = useState<EditAnn>(
    initial ?? { id: "", title: "", date: today, desc: "", points: [""], color: ANN_COLORS[0], image: "", ctaHref: "", audience: "USER", storeIds: [], status: "DRAFT", version: 1 },
  );
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState("");
  const [, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showNotSeen, setShowNotSeen] = useState(false);
  const set = <K extends keyof EditAnn>(k: K, v: EditAnn[K]) => setF((o) => ({ ...o, [k]: v }));
  const published = f.status === "PUBLISHED";

  const run = (op: AnnInput["op"]) => {
    if (op === "republish" && !confirm("Hiện lại bản này cho TẤT CẢ mọi người (kể cả người đã xem)?")) return;
    setBusy(op);
    setMsg({});
    start(async () => {
      const r = await saveAnnouncement({ ...f, id: f.id || undefined, op });
      setBusy("");
      if (r.error) return setMsg({ err: r.error });
      setMsg({ ok: op === "draft" ? "Đã lưu nháp" : op === "publish" ? "Đã đăng – ai chưa xem sẽ thấy popup" : "Đã hiện lại cho tất cả" });
      if (!f.id && r.id) router.replace(`/admin/settings/announcements?id=${r.id}`);
      else router.refresh();
    });
  };
  const status = (op: "off" | "on" | "delete") => {
    if (op === "delete" && !confirm("Xoá hẳn bản giới thiệu này?")) return;
    setBusy(op);
    setMsg({});
    start(async () => {
      const r = await setAnnouncementStatus(f.id, op);
      setBusy("");
      if (r.error) return setMsg({ err: r.error });
      if (op === "delete") router.replace("/admin/settings/announcements");
      else {
        set("status", op === "off" ? "OFF" : "PUBLISHED");
        setMsg({ ok: op === "off" ? "Đã tắt – không hiện popup nữa" : "Đã bật lại" });
        router.refresh();
      }
    });
  };
  const pick = async (file?: File) => {
    if (!file) return;
    try {
      set("image", await shrink(file));
    } catch (e) {
      setMsg({ err: (e as Error).message });
    }
  };

  const points = f.points.length ? f.points : [""];
  const btn = (key: string, label: string, cls: string, onClick: () => void, disabled = false) => (
    <button type="button" onClick={onClick} disabled={!!busy || disabled} className={`rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-50 ${cls}`}>
      {busy === key ? "Đang lưu…" : label}
    </button>
  );

  return (
    <section className="grid gap-4 rounded-2xl bg-card p-4 ring-1 ring-line xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <b className="text-accent">{f.id ? "Sửa bản giới thiệu" : "Bản giới thiệu mới"}</b>
          {f.id && f.version > 1 && <span className="text-xs text-ink/60">Phiên bản {f.version}</span>}
        </div>

        <label className="block space-y-1 text-sm">
          <span className="font-semibold">Tiêu đề *</span>
          <input className={input} maxLength={80} value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="VD: Đổi giao diện theo ý bạn" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm">
            <span className="font-semibold">Ngày cập nhật</span>
            <input type="date" className={input} value={f.date} onChange={(e) => set("date", e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold">Nút “Thử ngay” mở tới</span>
            <select className={input} value={f.ctaHref} onChange={(e) => set("ctaHref", e.target.value)}>
              {CTA_PAGES.map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="block space-y-1 text-sm">
          <span className="font-semibold">Mô tả ngắn</span>
          <textarea className={input} rows={2} maxLength={300} value={f.desc} onChange={(e) => set("desc", e.target.value)} placeholder="1–2 câu nói tính năng giúp gì cho nhân viên" />
        </label>

        <div className="space-y-1.5 text-sm">
          <span className="font-semibold">Các bước / điểm chính (tối đa 4)</span>
          {points.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary">{i + 1}</span>
              <input
                className={input}
                maxLength={120}
                value={p}
                onChange={(e) => set("points", points.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="VD: Vào Cài đặt → Giao diện"
              />
              {points.length > 1 && (
                <button type="button" aria-label="Xoá dòng" className="shrink-0 px-1 text-bad-fg" onClick={() => set("points", points.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {points.length < 4 && (
            <button type="button" className="text-sm font-semibold text-accent underline" onClick={() => set("points", [...points, ""])}>
              + Thêm dòng
            </button>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          <span className="font-semibold">Màu nền &amp; ảnh minh hoạ</span>
          <div className="flex flex-wrap items-center gap-2">
            {ANN_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set("color", c)}
                className={`h-8 w-8 rounded-full ring-offset-2 ring-offset-card ${f.color === c ? "ring-2 ring-accent" : "ring-1 ring-line"}`}
                style={{ background: c }}
              />
            ))}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0] ?? undefined)} />
            <button type="button" className="rounded-xl bg-chip px-3 py-1.5 font-semibold" onClick={() => fileRef.current?.click()}>
              📷 {f.image ? "Đổi ảnh" : "Tải ảnh"}
            </button>
            {f.image && (
              <button type="button" className="text-bad-fg underline" onClick={() => set("image", "")}>
                Bỏ ảnh
              </button>
            )}
          </div>
          <p className="text-xs text-ink/60">Không có ảnh → dùng hình hộp quà mặc định. Nên dùng ảnh chụp màn hình tính năng.</p>
        </div>

        <div className="space-y-1.5 text-sm">
          <span className="font-semibold">Ai sẽ thấy</span>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["USER", "Nhân viên"],
                ["ADMIN", "Admin"],
                ["ALL", "Cả hai"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => set("audience", v)}
                className={`rounded-full px-3 py-1.5 font-semibold ${f.audience === v ? "bg-accent text-on-accent" : "bg-chip"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {f.audience !== "ADMIN" && stores.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-ink/60">Cơ sở:</span>
              <button
                type="button"
                onClick={() => set("storeIds", [])}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${!f.storeIds.length ? "bg-accent text-on-accent" : "bg-chip"}`}
              >
                Tất cả
              </button>
              {stores.map((s) => {
                const on = f.storeIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => set("storeIds", on ? f.storeIds.filter((x) => x !== s.id) : [...f.storeIds, s.id])}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-accent text-on-accent" : "bg-chip"}`}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {msg.err && <p className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad-fg">{msg.err}</p>}
        {msg.ok && <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-good">{msg.ok}</p>}

        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {btn("draft", published ? "Lưu thay đổi" : "Lưu nháp", "bg-chip", () => run("draft"))}
          {!published && btn("publish", "Đăng", "border border-primary-dark bg-primary text-on-primary", () => run("publish"))}
          {published && f.id && btn("republish", "Hiện lại cho tất cả", "border border-primary-dark bg-primary text-on-primary", () => run("republish"))}
          {f.id && published && btn("off", "Tắt", "bg-bad-bg text-bad-fg", () => status("off"))}
          {f.id && f.status === "OFF" && btn("on", "Bật lại", "bg-ok-bg text-good", () => status("on"))}
          {f.id && btn("delete", "Xoá", "ml-auto text-bad-fg underline", () => status("delete"))}
        </div>
        {published && (
          <p className="text-xs text-ink/60">
            “Lưu thay đổi” chỉ sửa nội dung – người đã xem không thấy lại. “Hiện lại cho tất cả” → mọi người thấy popup lần nữa.
          </p>
        )}
      </div>

      <aside className="space-y-3">
        <span className="block text-sm font-semibold">Xem trước trên điện thoại</span>
        <div className="mx-auto w-[260px] rounded-[2rem] bg-ink/90 p-2 shadow-lg">
          <div className="flex h-[480px] items-center rounded-[1.6rem] bg-black/50 p-3">
            <div className="w-full overflow-hidden rounded-2xl bg-card shadow-xl">
              <AnnSlide
                compact
                a={{
                  id: f.id || "preview",
                  title: f.title || "Tiêu đề tính năng",
                  date: f.date,
                  desc: f.desc,
                  points: points.filter((p) => p.trim()),
                  color: f.color,
                  image: f.image || undefined,
                  ctaHref: f.ctaHref || undefined,
                  version: f.version,
                }}
              />
              {points.some((p) => p.trim()) && (
                <ol className="space-y-1 px-3 pb-1 text-[11px]">
                  {points
                    .filter((p) => p.trim())
                    .map((p, i) => (
                      <li key={i} className="flex gap-1.5">
                        <b className="text-accent">{i + 1}.</b>
                        <span className="min-w-0">{p}</span>
                      </li>
                    ))}
                </ol>
              )}
              <div className="space-y-1.5 p-3">
                {f.ctaHref && <div className="rounded-xl bg-primary py-2 text-center text-xs font-extrabold text-on-primary">Thử ngay</div>}
                <div className="rounded-xl bg-chip py-2 text-center text-xs font-bold">Đã hiểu</div>
              </div>
            </div>
          </div>
        </div>
        {f.id && f.status !== "DRAFT" && (
          <div className="rounded-xl bg-muted p-3 text-sm">
            {notSeen.length ? (
              <>
                <button type="button" className="font-semibold text-accent underline" onClick={() => setShowNotSeen((v) => !v)}>
                  {notSeen.length} người chưa xem {showNotSeen ? "▲" : "▼"}
                </button>
                {showNotSeen && <p className="mt-1 text-xs leading-relaxed text-ink/70">{notSeen.join(", ")}</p>}
              </>
            ) : (
              <span className="text-good">✓ Mọi người đã xem</span>
            )}
          </div>
        )}
      </aside>
    </section>
  );
}
