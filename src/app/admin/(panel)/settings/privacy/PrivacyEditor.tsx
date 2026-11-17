"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import Markdown from "@/components/Markdown";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/format";
import { savePrivacy } from "@/app/admin/actions/privacy";

const HINT = (
  <p className="text-xs leading-relaxed text-ink/60">
    Cách gõ Markdown: <code># Tiêu đề</code> · <code>## Mục</code> · <code>- gạch đầu dòng</code> · <code>1. danh sách số</code> · <code>**chữ đậm**</code> ·{" "}
    <code>&gt; khung ghi chú</code> · <code>| bảng | 2 cột |</code> · <code>[chữ](https://link)</code> · dòng trống = đoạn mới.
  </p>
);

type Props = {
  initial: string;
  template: string;
  version: number;
  publishedAt: string;
  updatedAt: string;
  stats: { active: number; agreed: number };
};

/** Soạn Chính sách quyền riêng tư (Markdown) + xem trước như trên điện thoại nhân viên. */
export default function PrivacyEditor({ initial, template, version, publishedAt, updatedAt, stats }: Props) {
  const router = useRouter();
  const [md, setMd] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [view, setView] = useState<"edit" | "preview">("edit"); // điện thoại: chuyển qua lại; máy tính: hiện cả 2
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [pending, start] = useTransition();
  const dirty = md.trim() !== saved.trim();
  const next = version + 1;

  const save = (publish: boolean) => {
    if (
      publish &&
      !confirm(
        version === 0
          ? "Phát hành Chính sách v1?\n\nMọi nhân viên sẽ phải đọc và bấm đồng ý trước khi chấm công tiếp."
          : `Phát hành phiên bản mới v${next}?\n\nMọi nhân viên (kể cả đã đồng ý v${version}) sẽ phải đồng ý lại trước khi chấm công tiếp.`,
      )
    )
      return;
    start(async () => {
      setMsg({});
      const r = await savePrivacy(md, publish);
      if (r.error) return setMsg({ err: r.error });
      setSaved(md);
      setMsg({
        ok: publish
          ? `Đã phát hành v${r.version} – nhân viên sẽ được hỏi đồng ý ở lần mở app tới`
          : version === 0
            ? "Đã lưu bản nháp – nhân viên chưa thấy cho đến khi bấm Phát hành"
            : `Đã lưu – vẫn là v${version}, nhân viên thấy nội dung mới ngay, không phải đồng ý lại`,
      });
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      {/* trạng thái */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 text-sm ring-1 ring-line">
        {version > 0 ? (
          <>
            <span className="rounded-full bg-green-100 px-2.5 py-1 font-bold text-green-800">Đang áp dụng v{version}</span>
            <span className="text-ink/70">Phát hành {publishedAt}</span>
            {updatedAt && updatedAt !== publishedAt && <span className="text-ink/50">· sửa nhỏ lần cuối {updatedAt}</span>}
            <span className="ml-auto">
              Đã đồng ý v{version}: <b>{stats.agreed}</b>/{stats.active} nhân viên
              {stats.active > stats.agreed && <span className="text-warn"> · {stats.active - stats.agreed} chưa đồng ý (chưa chấm công được)</span>}
            </span>
          </>
        ) : (
          <>
            <span className="rounded-full bg-yellow-100 px-2.5 py-1 font-bold text-yellow-800">Chưa phát hành</span>
            <span className="text-ink/70">Nhân viên chưa thấy chính sách, chưa bị hỏi đồng ý.</span>
          </>
        )}
      </div>

      {msg.err && <Alert tone="red">{msg.err}</Alert>}
      {msg.ok && <Alert tone="green">{msg.ok}</Alert>}

      {/* điện thoại: chọn Soạn / Xem trước */}
      <div className="flex gap-1.5 lg:hidden">
        {(["edit", "preview"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={cn("flex-1 rounded-xl px-3 py-2 text-sm", view === k ? "bg-secondary font-bold text-white" : "bg-card text-ink/70 ring-1 ring-line")}
          >
            {k === "edit" ? "✏️ Soạn" : "👁 Xem trước"}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- soạn ---------- */}
        <div className={cn("min-w-0 space-y-3 rounded-2xl bg-card p-4 ring-1 ring-line", view !== "edit" && "hidden lg:block")}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold text-accent">✏️ Nội dung (Markdown){dirty && <span className="ml-1 text-warn" title="Chưa lưu">●</span>}</p>
            <span className="ml-auto flex gap-1.5">
              {md.trim() !== template.trim() && (
                <Button
                  type="button"
                  variant="outline"
                  className="px-2.5 py-1 text-xs"
                  onClick={() => (!md.trim() || confirm("Thay nội dung đang soạn bằng mẫu gợi ý?")) && setMd(template)}
                >
                  Dùng mẫu gợi ý
                </Button>
              )}
              {dirty && (
                <Button type="button" variant="outline" className="px-2.5 py-1 text-xs" onClick={() => confirm("Bỏ các thay đổi chưa lưu?") && setMd(saved)}>
                  Hoàn tác
                </Button>
              )}
            </span>
          </div>
          {HINT}
          <textarea
            value={md}
            onChange={(e) => setMd(e.target.value)}
            placeholder="Bấm “Dùng mẫu gợi ý” để có sẵn khung 7 mục, điền phần [ … ] rồi phát hành."
            className="min-h-[520px] w-full rounded-xl border border-line bg-card p-3 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-right text-xs text-ink/50">{md.length.toLocaleString("vi-VN")} ký tự</p>
        </div>

        {/* ---------- xem trước ---------- */}
        <div className={cn("min-w-0", view !== "preview" && "hidden lg:block")}>
          <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-[28px] border-[6px] border-[#3a2424] bg-cream shadow-lg">
            <div className="flex items-center gap-2 bg-primary px-3 py-2 text-sm font-bold text-on-primary">
              <Smartphone size={14} /> Chính sách quyền riêng tư
              <span className="ml-auto text-[11px] font-normal opacity-80">{dirty || version === 0 ? `bản sẽ phát hành v${next}` : `v${version}`}</span>
            </div>
            <div className="max-h-[640px] overflow-y-auto bg-card p-4">
              <Markdown text={md} empty="Chưa có nội dung – soạn bên trái." />
            </div>
          </div>
        </div>
      </div>

      {/* lưu */}
      <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-2xl bg-card p-3 shadow-lg ring-1 ring-line">
        <Button type="button" variant="outline" loading={pending} disabled={!dirty} onClick={() => save(false)}>
          {version === 0 ? "Lưu nháp" : "Lưu sửa nhỏ (giữ v" + version + ")"}
        </Button>
        <Button type="button" loading={pending} disabled={!md.trim()} onClick={() => save(true)}>
          {version === 0 ? "Phát hành v1" : `Phát hành v${next} – bắt đồng ý lại`}
        </Button>
        <p className="w-full text-xs text-ink/60">
          <b>Sửa nhỏ</b> (chính tả, SĐT người phụ trách…): nhân viên thấy ngay, không phải đồng ý lại. <b>Phát hành bản mới</b> khi đổi dữ liệu thu / cách lưu: nhân viên phải
          đồng ý lại mới chấm công được.
        </p>
      </div>
    </div>
  );
}
