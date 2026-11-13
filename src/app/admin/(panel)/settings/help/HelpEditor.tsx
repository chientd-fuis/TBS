"use client";
import { useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, FileUp, Plus, Smartphone, Trash2 } from "lucide-react";
import RulesView from "@/components/RulesView";
import FaqList from "@/components/help/FaqList";
import WorkflowView from "@/components/help/WorkflowView";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/format";
import { HELP_PLACEHOLDER, HELP_SECTIONS, POSITIONS, type FaqItem, type HelpContent, type HelpSectionKey, type PositionKey } from "@/lib/help";
import { importHelpDocx, saveHelpSection } from "@/app/admin/actions/help";

const FORMAT_HINT = (
  <p className="text-xs leading-relaxed text-ink/60">
    Cách gõ: <code># Tiêu đề</code> · <code>1. Bước / điều</code> (dòng dưới không đánh số = giải thích) · <code>- ý nhỏ</code> · <code>**chữ đậm**</code> ·{" "}
    <code>! Lưu ý</code> (khung vàng).
  </p>
);

/** Khung điện thoại để xem trước giống app nhân viên */
function PhonePreview({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[28px] border-[6px] border-[#3a2424] bg-cream shadow-lg">
      <div className="flex items-center gap-2 bg-primary text-on-primary px-3 py-2 text-sm font-bold">
        <Smartphone size={14} /> {title}
      </div>
      <div className="max-h-[560px] overflow-y-auto p-3">{children}</div>
    </div>
  );
}

/** Soạn 4 mục Help + xem trước như trên app nhân viên. */
export default function HelpEditor({ initial }: { initial: HelpContent }) {
  const [tab, setTab] = useState<HelpSectionKey>("guide");
  const [guide, setGuide] = useState(initial.guide);
  const [guideFile, setGuideFile] = useState(initial.guideFile);
  const [workflow, setWorkflow] = useState<Record<PositionKey, string>>(initial.workflow);
  const [pos, setPos] = useState<PositionKey>("BEP");
  const [about, setAbout] = useState(initial.about);
  const [faq, setFaq] = useState<FaqItem[]>(initial.faq.length ? initial.faq : [{ q: "", a: "" }]);
  const [saved, setSaved] = useState<HelpContent>(initial);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty: Record<HelpSectionKey, boolean> = {
    guide: guide !== saved.guide,
    workflow: POSITIONS.some((p) => workflow[p.key] !== saved.workflow[p.key]),
    about: about !== saved.about,
    faq: JSON.stringify(faq.filter((x) => x.q.trim() || x.a.trim()).map((x) => ({ q: x.q.trim(), a: x.a.trim() }))) !== JSON.stringify(saved.faq),
  };

  const save = () =>
    start(async () => {
      setMsg({});
      const payload = tab === "guide" ? guide : tab === "workflow" ? workflow : tab === "about" ? about : faq.filter((x) => x.q.trim() || x.a.trim());
      const r = await saveHelpSection(tab, payload, tab === "guide" ? guideFile : undefined);
      if (r.error) return setMsg({ err: r.error });
      // chỉ mục vừa lưu được tính "đã lưu" (mục khác đang sửa dở vẫn giữ dấu ●)
      setSaved((s) =>
        tab === "guide"
          ? { ...s, guide, guideFile }
          : tab === "workflow"
            ? { ...s, workflow }
            : tab === "about"
              ? { ...s, about }
              : { ...s, faq: faq.filter((x) => x.q.trim() || x.a.trim()).map((x) => ({ q: x.q.trim(), a: x.a.trim() })) },
      );
      setMsg({ ok: "Đã lưu – nhân viên thấy ngay" });
    });

  const importWord = (f: File) =>
    start(async () => {
      setMsg({});
      const fd = new FormData();
      fd.append("file", f);
      const r = await importHelpDocx(fd);
      if (fileRef.current) fileRef.current.value = "";
      if (r.error || !r.text) return setMsg({ err: r.error ?? "Không đọc được file" });
      setGuide(r.text);
      setGuideFile(r.name ?? "");
      setMsg({ ok: `Đã nhập “${r.name}” – xem trước bên phải, sửa nếu cần rồi bấm Lưu` });
    });

  const setQ = (i: number, k: keyof FaqItem, v: string) => setFaq((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const move = (i: number, d: -1 | 1) =>
    setFaq((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const area = "min-h-[340px] w-full rounded-xl border border-line bg-card p-3 font-mono text-[13px] leading-relaxed outline-none focus:ring-2 focus:ring-primary";
  const sec = HELP_SECTIONS.find((s) => s.key === tab)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {HELP_SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => (setTab(s.key), setMsg({}))}
            className={cn("rounded-xl px-3 py-2 text-sm", tab === s.key ? "bg-secondary font-bold text-white" : "bg-card text-ink/70 ring-1 ring-line hover:bg-primary-light")}
          >
            {s.icon} {s.label}
            {dirty[s.key] && <span className="ml-1 text-warn" title="Chưa lưu">●</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ---------- soạn ---------- */}
        <div className="min-w-0 space-y-3 rounded-2xl bg-card p-4 ring-1 ring-line">
          <p className="font-bold text-accent">
            {sec.icon} {sec.label}
          </p>

          {tab === "guide" && (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-cream p-2 text-sm">
                <input ref={fileRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="hidden" onChange={(e) => e.target.files?.[0] && importWord(e.target.files[0])} />
                <Button type="button" variant="outline" disabled={pending} onClick={() => fileRef.current?.click()}>
                  <FileUp size={16} /> Nhập file Word (.docx)
                </Button>
                <span className="text-xs text-ink/60">{guideFile ? `File gần nhất: ${guideFile}` : "Nhập xong vẫn sửa được trước khi lưu. Tiêu đề trong Word → tiêu đề, danh sách → gạch đầu dòng, chữ đậm giữ nguyên."}</span>
              </div>
              {FORMAT_HINT}
              <textarea value={guide} onChange={(e) => setGuide(e.target.value)} placeholder={HELP_PLACEHOLDER.guide} className={area} />
            </>
          )}

          {tab === "workflow" && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {POSITIONS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPos(p.key)}
                    className={cn("rounded-full px-3 py-1.5 text-sm", pos === p.key ? "bg-primary text-on-primary font-bold" : "bg-cream text-ink/70 ring-1 ring-line")}
                  >
                    {p.icon} {p.label}
                    {!workflow[p.key].trim() && <span className="ml-1 text-xs text-warn">(trống)</span>}
                  </button>
                ))}
              </div>
              {FORMAT_HINT}
              <textarea
                value={workflow[pos]}
                onChange={(e) => setWorkflow((w) => ({ ...w, [pos]: e.target.value }))}
                placeholder={HELP_PLACEHOLDER.workflow}
                className={area}
              />
              <p className="text-xs text-ink/60">Nhân viên mở “Quy trình làm việc” sẽ được hỏi vị trí (Bếp / Thu ngân / Ship / Đa năng) rồi xem đúng quy trình. Lưu = lưu cả 4 vị trí.</p>
            </>
          )}

          {tab === "about" && (
            <>
              {FORMAT_HINT}
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} placeholder={HELP_PLACEHOLDER.about} className={area} />
            </>
          )}

          {tab === "faq" && (
            <div className="space-y-3">
              <p className="text-xs text-ink/60">Mỗi tình huống gồm câu hỏi và câu trả lời. Câu trả lời gõ được định dạng như trên (1. bước, - ý, **đậm**, ! lưu ý).</p>
              {faq.map((x, i) => (
                <div key={i} className="space-y-2 rounded-xl bg-cream p-3 ring-1 ring-line">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-bold text-ink/50">#{i + 1}</span>
                    <input
                      value={x.q}
                      onChange={(e) => setQ(i, "q", e.target.value)}
                      placeholder="Câu hỏi – VD: Khách muốn đổi món đã làm?"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-card px-2 py-1.5 text-sm font-semibold outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Lên" className="rounded p-1 text-ink/60 disabled:opacity-30">
                      <ArrowUp size={16} />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === faq.length - 1} aria-label="Xuống" className="rounded p-1 text-ink/60 disabled:opacity-30">
                      <ArrowDown size={16} />
                    </button>
                    <button type="button" onClick={() => setFaq((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [{ q: "", a: "" }]))} aria-label="Xoá" className="rounded p-1 text-danger">
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <textarea
                    value={x.a}
                    onChange={(e) => setQ(i, "a", e.target.value)}
                    placeholder={"Câu trả lời – VD:\n1. Xin lỗi khách, hỏi lý do\n2. Báo quản lý ca nếu phải làm lại\n! Không tự ý hoàn tiền"}
                    className="min-h-[90px] w-full rounded-lg border border-line bg-card p-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => setFaq((l) => [...l, { q: "", a: "" }])}>
                <Plus size={16} /> Thêm tình huống
              </Button>
            </div>
          )}

          {msg.err && <Alert tone="red">{msg.err}</Alert>}
          {msg.ok && <Alert tone="green">{msg.ok}</Alert>}
          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" disabled={pending || !dirty[tab]} onClick={save}>
              {pending ? "Đang lưu…" : `Lưu ${sec.label.toLowerCase()}`}
            </Button>
            {!dirty[tab] && <span className="text-xs text-ink/50">Không có thay đổi</span>}
          </div>
        </div>

        {/* ---------- xem trước ---------- */}
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-semibold text-ink/70">Xem trước trên app nhân viên</p>
          <PhonePreview title={`${sec.icon} ${sec.label}`}>
            {tab === "guide" && <RulesView text={guide} empty="(trống)" />}
            {tab === "workflow" && <WorkflowView content={workflow} fixed={pos} />}
            {tab === "about" && <RulesView text={about} empty="(trống)" />}
            {tab === "faq" && <FaqList items={faq.filter((x) => x.q.trim())} />}
          </PhonePreview>
        </div>
      </div>
    </div>
  );
}
