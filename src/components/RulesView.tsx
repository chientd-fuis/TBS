import { boldParts, parseRules } from "@/lib/rules-format";

const B = ({ text }: { text: string }) => (
  <>
    {boldParts(text).map(([t, b], i) => (b ? <b key={i} className="text-accent">{t}</b> : <span key={i}>{t}</span>))}
  </>
);

/** Hiển thị nội quy đã định dạng (thẻ đánh số, ý nhỏ, khung lưu ý) – dùng ở popup nhân viên và xem trước cho admin. */
export default function RulesView({ text, empty }: { text: string; empty?: string }) {
  const blocks = parseRules(text);
  if (!blocks.length) return <p className="py-6 text-center text-sm text-ink/60">{empty ?? "Chưa có nội quy – admin cập nhật ở Cài đặt → AI → Nội quy, quy định."}</p>;
  return (
    <div className="space-y-2.5 text-[15px] leading-relaxed">
      {blocks.map((b, i) =>
        b.kind === "heading" ? (
          <h3 key={i} className="pt-1 text-center text-lg font-bold text-accent">
            <B text={b.text} />
          </h3>
        ) : b.kind === "item" ? (
          <div key={i} className="flex gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-on-primary">{b.no}</span>
            <div className="min-w-0">
              <p><B text={b.text} /></p>
              {b.sub.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-ink/80">
                  {b.sub.map((s, k) => (
                    <li key={k}><B text={s} /></li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : b.kind === "note" ? (
          <p key={i} className="rounded-xl bg-primary-light px-3 py-2 text-sm">
            ⚠️ <B text={b.text} />
          </p>
        ) : b.kind === "bullet" ? (
          <p key={i} className="pl-3 text-sm">• <B text={b.text} /></p>
        ) : (
          <p key={i} className="text-sm"><B text={b.text} /></p>
        ),
      )}
    </div>
  );
}
