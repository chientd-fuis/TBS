/*
 * Tính biểu thức tiền an toàn (không dùng eval): "31 × 5k", "31*5000", "3*35k + 2*55k - 10%", "1tr2 / 4", "(20k+15k)*2".
 * Số: 5000 · 5.000 · 1.200.000 (dấu chấm nhóm nghìn) · 5,5 (phẩy thập phân) · 5k / 5 nghìn · 1tr / 1tr2 / 1,5tr.
 * Toán tử: + − - × x * ÷ / : và % (đứng sau số: "10%" = 0,1; "a - 10%" = a giảm 10%, "a + 10%" = a tăng 10%).
 * Hàm thuần – có test.
 */
type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "pct" };

function tokenize(src: string): Tok[] | null {
  const s = src.toLowerCase().replace(/đ|₫|vnd|đồng/g, "").replace(/\s+/g, " ").trim();
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    const m = /^(\d+(?:[.,]\d+)*)\s*(tr(?:iệu)?\s*\d{0,3}|k|nghìn|ngàn)?/.exec(s.slice(i));
    if (m) {
      let raw = m[1];
      // "5.000" / "1.200.000" = nhóm nghìn; "5,5" = thập phân; "1,200,000" = nhóm nghìn
      if (/^\d{1,3}(\.\d{3})+$/.test(raw)) raw = raw.replace(/\./g, "");
      else if (/^\d{1,3}(,\d{3}){2,}$/.test(raw)) raw = raw.replace(/,/g, "");
      else raw = raw.replace(",", ".");
      let v = Number(raw);
      if (!Number.isFinite(v)) return null;
      const unit = (m[2] ?? "").replace(/\s+/g, "");
      if (unit === "k" || unit === "nghìn" || unit === "ngàn") v *= 1000;
      else if (unit.startsWith("tr")) {
        const tail = unit.replace(/^tr(iệu)?/, ""); // "1tr2" = 1.200.000
        v = v * 1_000_000 + (tail ? Number(tail.padEnd(3, "0").slice(0, 3)) * 1000 : 0);
      }
      out.push({ t: "num", v });
      i += m[0].length;
      continue;
    }
    if (c === "%") out.push({ t: "pct" });
    else if ("+".includes(c)) out.push({ t: "op", v: "+" });
    else if ("-−–".includes(c)) out.push({ t: "op", v: "-" });
    else if ("*×x".includes(c)) out.push({ t: "op", v: "*" });
    else if ("/÷:".includes(c)) out.push({ t: "op", v: "/" });
    else if (c === "(" || c === ")") out.push({ t: "op", v: c });
    else return null; // ký tự lạ → không tính
    i++;
  }
  return out;
}

/** Kết quả làm tròn tới đồng; biểu thức sai / chia 0 → null. */
export function evalCalc(expr: string | null | undefined): number | null {
  const toks = tokenize(String(expr ?? ""));
  if (!toks?.length) return null;
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;

  // factor := ("-" factor) | number ["%"] | "(" expr ")"
  const factor = (): { v: number; pct: boolean } | null => {
    if (isOp("-")) {
      p++;
      const f = factor();
      return f ? { v: -f.v, pct: f.pct } : null;
    }
    if (isOp("(")) {
      p++;
      const e = sum();
      if (e == null || !isOp(")")) return null;
      p++;
      return { v: e, pct: false };
    }
    const t = peek();
    if (t?.t !== "num") return null;
    p++;
    if (peek()?.t === "pct") {
      p++;
      return { v: t.v / 100, pct: true };
    }
    return { v: t.v, pct: false };
  };
  const product = (): { v: number; pct: boolean } | null => {
    let a = factor();
    if (!a) return null;
    while (isOp("*") || isOp("/")) {
      const op = (peek() as { v: string }).v;
      p++;
      const b = factor();
      if (!b) return null;
      if (op === "/" && b.v === 0) return null;
      a = { v: op === "*" ? a.v * b.v : a.v / b.v, pct: false };
    }
    return a;
  };
  // "a - 10%" = a × 0,9 · "a + 10%" = a × 1,1
  const sum = (): number | null => {
    const first = product();
    if (!first) return null;
    let a = first.v;
    while (isOp("+") || isOp("-")) {
      const op = (peek() as { v: string }).v;
      p++;
      const b = product();
      if (!b) return null;
      const d = b.pct ? a * b.v : b.v;
      a = op === "+" ? a + d : a - d;
    }
    return a;
  };
  const v = sum();
  if (v == null || p !== toks.length || !Number.isFinite(v)) return null;
  return Math.round(v);
}
