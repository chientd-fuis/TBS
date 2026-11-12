import { inflateRawSync } from "node:zlib";

/*
 * Đọc file Word (.docx) → chữ theo định dạng nội quy (lib/rules-format.ts), không cần thư viện ngoài.
 * .docx là file zip: lấy word/document.xml, mỗi đoạn <w:p> thành 1 dòng:
 *   kiểu Title / Heading → "# …", đoạn có đánh số / gạch đầu dòng → "- …", chữ đậm → **…**.
 * Ảnh, bảng phức tạp, màu chữ… không giữ được (bảng thành từng dòng chữ).
 */

/** Lấy 1 file trong zip theo tên (hỗ trợ lưu thẳng / nén deflate – đủ cho .docx của Word / Google Docs). */
function zipEntry(buf: Buffer, name: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("File không phải .docx hợp lệ");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const lho = buf.readUInt32LE(off + 42);
    const fname = buf.toString("utf8", off + 46, off + 46 + nlen);
    if (fname === name) {
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error("Kiểu nén file Word không hỗ trợ");
    }
    off += 46 + nlen + elen + clen;
  }
  return null;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([\da-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** Chữ của 1 lượt (run): <w:t>, tab, xuống dòng */
function runText(run: string) {
  let out = "";
  for (const m of run.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g)) {
    if (m[1] != null) out += decode(m[1]);
    else out += m[0].startsWith("<w:tab") ? " " : "\n";
  }
  return out;
}

export function docxToText(buf: Buffer): string {
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new Error("Không tìm thấy nội dung trong file Word");
  const doc = xml.toString("utf8");
  const lines: string[] = [];
  for (const pm of doc.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const p = pm[1];
    const style = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1] ?? "";
    const list = /<w:numPr>/.test(p) || /List/i.test(style);
    let text = "";
    let bold = false;
    for (const rm of p.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)) {
      const r = rm[1];
      const t = runText(r);
      if (!t) continue;
      const b = /<w:b(?:\s+w:val="(?:1|true|on)")?\s*\/>/.test(r);
      if (b !== bold) {
        text += "**";
        bold = b;
      }
      text += t;
    }
    if (bold) text += "**";
    text = text.replace(/\*\*(\s*)\*\*/g, "$1").replace(/\*\*\s*\*\*/g, "");
    for (const part of text.split("\n")) {
      const t = part.replace(/\s+/g, " ").trim();
      if (!t || t === "****") continue;
      if (/^(Title|Heading\s?\d|Tieude|TOCHeading)/i.test(style)) lines.push(`# ${t.replace(/\*\*/g, "")}`);
      else if (list) lines.push(`- ${t}`);
      else lines.push(t);
    }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
