import type { ReactNode } from "react";

/*
 * Hiển thị Markdown đơn giản (không dùng HTML thô → không chèn được mã độc):
 *   # / ## / ### tiêu đề · - hoặc * gạch đầu dòng · 1. danh sách số · > khung ghi chú · --- kẻ ngang
 *   | bảng | … | · **đậm** · *nghiêng* · `mã` · [chữ](https://link)
 * Dòng liền nhau = cùng 1 đoạn (xuống dòng giữ nguyên); dòng trống = đoạn mới.
 */

type Block =
  | { k: "h"; level: 1 | 2 | 3; text: string }
  | { k: "p"; lines: string[] }
  | { k: "quote"; lines: string[] }
  | { k: "ul" | "ol"; items: string[] }
  | { k: "table"; rows: string[][] }
  | { k: "hr" };

const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const out: Block[] = [];
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    const last = out[out.length - 1];
    if (!l) {
      out.push({ k: "p", lines: [] }); // ngắt đoạn
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{1,3})\s+(.*)$/))) out.push({ k: "h", level: m[1].length as 1 | 2 | 3, text: m[2] });
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(l)) out.push({ k: "hr" });
    else if ((m = l.match(/^>\s?(.*)$/))) {
      if (last?.k === "quote") last.lines.push(m[1]);
      else out.push({ k: "quote", lines: [m[1]] });
    } else if ((m = l.match(/^[-*+]\s+(.*)$/))) {
      if (last?.k === "ul") last.items.push(m[1]);
      else out.push({ k: "ul", items: [m[1]] });
    } else if ((m = l.match(/^\d+[.)]\s+(.*)$/))) {
      if (last?.k === "ol") last.items.push(m[1]);
      else out.push({ k: "ol", items: [m[1]] });
    } else if (l.startsWith("|")) {
      if (/^\|?\s*:?-{2,}/.test(l) && /^[\s|:-]+$/.test(l)) continue; // dòng |---|---|
      if (last?.k === "table") last.rows.push(cells(l));
      else out.push({ k: "table", rows: [cells(l)] });
    } else if (last?.k === "p" && last.lines.length) last.lines.push(l);
    else out.push({ k: "p", lines: [l] });
  }
  return out.filter((b) => !(b.k === "p" && !b.lines.length));
}

const SAFE_URL = /^(https?:\/\/|mailto:|tel:|\/(?!\/))/i;

/** **đậm**, *nghiêng*, `mã`, [chữ](link) */
function Inline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])[*_]([^*_\s][^*_]*?)[*_](?![\w*]))/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    if (m[2] !== undefined) parts.push(<b key={n++} className="font-bold text-accent">{m[2]}</b>);
    else if (m[3] !== undefined) parts.push(<code key={n++} className="rounded bg-cream px-1 text-[0.9em]">{m[3]}</code>);
    else if (m[4] !== undefined)
      parts.push(
        SAFE_URL.test(m[5]) ? (
          <a key={n++} href={m[5]} target={m[5].startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="font-semibold text-accent underline">
            {m[4]}
          </a>
        ) : (
          m[0]
        ),
      );
    else if (m[6] !== undefined) parts.push(<i key={n++}>{m[6]}</i>);
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const Lines = ({ lines }: { lines: string[] }) => (
  <>
    {lines.map((l, i) => (
      <span key={i}>
        {i > 0 && <br />}
        <Inline text={l} />
      </span>
    ))}
  </>
);

export default function Markdown({ text, empty }: { text: string; empty?: ReactNode }) {
  const blocks = parseMarkdown(text);
  if (!blocks.length) return <p className="py-6 text-center text-sm text-ink/60">{empty ?? "Chưa có nội dung."}</p>;
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink">
      {blocks.map((b, i) => {
        switch (b.k) {
          case "h":
            return b.level === 1 ? (
              <h2 key={i} className="pt-1 text-lg font-extrabold text-accent"><Inline text={b.text} /></h2>
            ) : b.level === 2 ? (
              <h3 key={i} className="border-t border-line pt-3 text-[15px] font-bold text-accent"><Inline text={b.text} /></h3>
            ) : (
              <h4 key={i} className="pt-1 font-bold"><Inline text={b.text} /></h4>
            );
          case "hr":
            return <hr key={i} className="border-line" />;
          case "quote":
            return (
              <div key={i} className="rounded-xl bg-primary-light px-3 py-2">
                <Lines lines={b.lines} />
              </div>
            );
          case "ul":
          case "ol": {
            const L = b.k === "ul" ? "ul" : "ol";
            return (
              <L key={i} className={`space-y-1 pl-5 ${b.k === "ul" ? "list-disc" : "list-decimal"}`}>
                {b.items.map((t, k) => (
                  <li key={k}><Inline text={t} /></li>
                ))}
              </L>
            );
          }
          case "table": {
            const [head, ...rows] = b.rows;
            return (
              <div key={i} className="overflow-x-auto rounded-xl ring-1 ring-line">
                <table className="w-full text-left text-[13px]">
                  <thead className="bg-cream">
                    <tr>{head.map((c, k) => <th key={k} className="px-2.5 py-1.5 font-bold"><Inline text={c} /></th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, k) => (
                      <tr key={k} className="border-t border-line">
                        {head.map((_, j) => <td key={j} className="px-2.5 py-1.5 align-top"><Inline text={r[j] ?? ""} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          }
          default:
            return <p key={i}><Lines lines={b.lines} /></p>;
        }
      })}
    </div>
  );
}
