/*
 * Nhận hàng các cơ sở: danh mục nguyên liệu + bộ đọc tin nhắn "nhận …" (không cần AI).
 * Dùng được cả ở trình duyệt (gõ tới đâu hiểu tới đó) lẫn server.
 *
 * Danh mục lưu ở Settings.goods dạng chữ, mỗi dòng 1 món:  Tên | đơn vị | cách gọi tắt, cách gọi tắt…
 */

export type GoodsItem = { name: string; unit: string; aliases: string[] };
export type GoodsLine = { name: string; qty: number; unit: string };

/** Danh mục mặc định – Admin sửa ở trang Nhận hàng → Danh mục. */
export const DEFAULT_GOODS: GoodsItem[] = [
  ["Sầu sên", "", "sầu riêng sên, sau sen"],
  ["Sầu múi", "", "sầu riêng múi"],
  ["Hạt đác", "", "đác"],
  ["Thốt nốt", "", ""],
  ["Dừa non", "", ""],
  ["Lọt", "", "bánh lọt"],
  ["Bơ", "", "quả bơ"],
  ["Kem dừa", "", ""],
  ["Kem dâu", "", ""],
  ["Kem xoài", "", ""],
  ["Kem km", "", "kem khoai môn"],
  ["Kem matcha", "", "kem trà xanh"],
  ["Kem bạc hà", "", ""],
  ["Kem scl", "", "kem socola, kem sô cô la, kem chocolate, kem cl, kem sl"],
  ["Kem cv", "", ""],
  ["Xúc xích", "", "xx"],
  ["Nước dừa", "", ""],
  ["Mít", "", ""],
  ["Xoài", "", ""],
  ["Dưa hấu", "", ""],
  ["Thanh long", "", ""],
  ["Sương sa", "", "thạch sương sa"],
  ["Trân trâu", "", "trân châu"],
  ["Bột báng", "", ""],
  ["Ốc quế", "", ""],
  ["Lạc", "", "đậu phộng"],
  ["Rick", "", ""],
  ["Ambie", "", ""],
  ["Cốt dừa", "", ""],
  ["Sữa tươi", "", ""],
  ["Sữa đặc", "", ""],
  ["Bột mì", "", ""],
  ["Bột năng", "", "bột na"],
  ["Bột trà sữa", "", ""],
  ["Đường", "", ""],
  ["Bột arga", "", "bột agar, agar"],
  ["Bột sóc vàng", "", ""],
  ["Gạo", "", ""],
  ["Caramen", "", "caramel"],
  ["Mini", "hộp", "mn, bánh mini"],
  ["Ngàn lớp", "bánh", "nl, bánh ngàn lớp, nghìn lớp"],
  ["Cốt chè", "", ""],
  ["Cốt châm", "", ""],
  ["Bột ca cao", "", "ca cao, cacao, bột cacao"],
  ["Bột bắp", "", ""],
  ["Bột béo", "", ""],
  ["Khô bò", "", ""],
  ["Khô gà", "", ""],
  ["Bỏng ngô", "", "bắp rang"],
  ["Bimbim mix", "", "bimbim, bim bim"],
  ["Dừa khô", "", ""],
  ["Pudding bơ", "", "pudding"],
  ["Cốc nhựa 360ml", "", "cốc 360, ly 360, cốc 360ml, ly 360ml"],
  ["Cốc nhựa 500ml", "", "cốc 500, ly 500, cốc 500ml, ly 500ml"],
  ["Hộp nhựa mini", "", ""],
  ["Hộp nhựa NL", "", "hộp nhựa ngàn lớp"],
  ["Hộp nhựa vuông", "", "hộp vuông"],
  ["Hộp nhựa oval", "", "hộp oval"],
  ["Túi đôi", "", ""],
  ["Túi đơn", "", ""],
  ["Túi to", "", ""],
  ["Găng tay", "", ""],
  ["Túi rác", "", ""],
].map(([name, unit, al]) => ({ name, unit, aliases: al ? al.split(",").map((x) => x.trim()).filter(Boolean) : [] }));

/** Danh mục → chữ để sửa (mỗi dòng: Tên | đơn vị | tắt1, tắt2). */
export function catalogToText(items: GoodsItem[]) {
  return items.map((i) => [i.name, i.unit, i.aliases.join(", ")].join(" | ").replace(/( \| )+$/, "")).join("\n");
}

/** Chữ → danh mục (bỏ dòng trống, trùng tên giữ dòng đầu). */
export function parseCatalog(text: string): GoodsItem[] {
  const seen = new Set<string>();
  const out: GoodsItem[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const [name = "", unit = "", al = ""] = line.split("|").map((x) => x.trim());
    const n = name.replace(/\s+/g, " ").slice(0, 60);
    if (!n || seen.has(foldGoods(n))) continue;
    seen.add(foldGoods(n));
    out.push({ name: n, unit: unit.slice(0, 20), aliases: al.split(",").map((x) => x.trim().slice(0, 40)).filter(Boolean).slice(0, 20) });
  }
  return out;
}

/** bỏ dấu, chữ thường (đ → d) */
export const foldGoods = (s: string) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** "5mn" → ["5","mn"], "1,5kg" → ["1.5","kg"], "cốc 360ml" → ["coc","360","ml"] */
function tokens(s: string) {
  return foldGoods(s)
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

/** đơn vị viết trong tin nhắn → chữ hiển thị */
const UNITS: Record<string, string> = {
  kg: "kg", kgs: "kg", ky: "kg", ki: "kg", can: "kg", g: "g", gr: "g", gam: "g", lang: "lạng",
  hop: "hộp", h: "hộp", thung: "thùng", tui: "túi", goi: "gói", bich: "bịch", cai: "cái", chai: "chai", lon: "lon",
  hu: "hũ", binh: "bình", l: "lít", lit: "lít", ml: "ml", cuon: "cuộn", banh: "bánh", qua: "quả", trai: "trái",
  bao: "bao", xo: "xô", khay: "khay", cay: "cây", vi: "vỉ", thanh: "thanh", set: "set", phan: "phần", ly: "ly", coc: "cốc", bo: "bó", tep: "tệp", loc: "lốc",
};
/** chữ đệm không phải tên món */
const FILLER = new Set(
  "nhan nhap da nhan hang do hom nay sang chieu toi nay ve them va voi cua gom co duoc roi a nhe nha oke ok em anh chi e a ah luc gio ngay x so luong sl tong la ton con kho kiem dem cuoi ca lai".split(" "),
);

type Alias = { toks: string[]; item: GoodsItem };
function aliasIndex(catalog: GoodsItem[]): Alias[] {
  const out: Alias[] = [];
  for (const item of catalog) for (const a of [item.name, ...item.aliases]) {
    const toks = tokens(a);
    if (toks.length) out.push({ toks, item });
  }
  return out.sort((a, b) => b.toks.length - a.toks.length);
}

const isNum = (t: string) => /^\d+(\.\d+)?$/.test(t);

/** Kem (tên bắt đầu "Kem "): nhân viên ghi số HỘP hoặc số GAM cân được */
export const isScoop = (name: string) => foldGoods(name).startsWith("kem ");
/** kem không ghi đơn vị: < 100 = hộp, ≥ 100 = gam */
export const scoopUnit = (q: number) => (q < 100 ? "hộp" : "g");
/**
 * Đơn vị tự hiểu khi nhân viên không ghi:
 *  kem: < 100 = hộp, ≥ 100 = gam
 *  bơ (nguyên liệu chính, ghi túi hoặc kg tuỳ người): số thập phân ("2,5") = kg, số nguyên → để trống (nhân viên tự ghi)
 */
export function autoUnit(name: string, qty: number): string {
  if (!(qty > 0)) return "";
  if (isScoop(name)) return scoopUnit(qty);
  if (foldGoods(name) === "bo" && !Number.isInteger(qty)) return "kg";
  return "";
}
/** dấu nối "1+245" giữ lại trong token (sau khi bỏ dấu câu) */
const PLUS = "zplusz";

type Part = { q: number; unit: string };
/**
 * Số ghi cho 1 món → các dòng:
 *  kem: mỗi phần 1 dòng theo đơn vị (1+245 → 1 hộp + 245 g, không cộng)
 *  món khác: cộng lại ("1+1" = 2), đơn vị theo phần đầu có ghi
 */
function resolveQty(name: string, itemUnit: string, parts: Part[]): { qty: number; unit: string }[] {
  if (isScoop(name)) return parts.map((p) => ({ qty: p.q, unit: p.unit || (p.q === 0 ? itemUnit : scoopUnit(p.q)) }));
  return [{ qty: Math.round(parts.reduce((s, p) => s + p.q, 0) * 1000) / 1000, unit: parts.find((p) => p.unit)?.unit || itemUnit }];
}

/** Token giữ cả chữ gốc (để báo "chưa hiểu" đúng chữ nhân viên gõ): t = đã bỏ dấu, o = nguyên văn */
type Tok = { t: string; o: string };
function rawTokens(s: string): Tok[] {
  return s
    .normalize("NFC")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d)(\p{L})/gu, "$1 $2")
    .replace(/(\p{L})(\d)/gu, "$1 $2")
    .split(/[^\p{L}\p{M}\p{N}.]+/u)
    .map((o) => o.replace(/^\.+|\.+$/g, ""))
    .flatMap((o) => {
      const t = foldGoods(o).replace(/[^a-z0-9.]/g, "");
      return t ? [{ t, o }] : [];
    });
}

/** tách đoạn: dấu phẩy / xuống dòng / ; / + giữa 2 món  (giữ "1,5kg" và "1+245" = 1 hộp + 245 g) */
const SEG = /(?<!\d),|,(?!\d)|[;\n]+|(?<!\d[a-zA-Z]*\s*)\+|\+(?!\s*\d)|\s[-–]\s/;
const segTokens = (seg: string) => rawTokens(seg.replace(/(\d[a-zA-Z]*)\s*\+\s*(?=\d)/g, `$1 ${PLUS} `));

/**
 * Tin ghi kiểu "TÊN SỐ, TÊN SỐ…" (tồn kho: "Xúc xích 19 Mít 4,5") hay "SỐ TÊN" ("nhận 5mn, 2nl")?
 * Đếm món có số đứng NGAY SAU vs NGAY TRƯỚC – kiểu nào nhiều hơn là quy luật của cả tin.
 */
function nameFirst(segs: Tok[][], idx: Alias[]) {
  let after = 0;
  let before = 0;
  for (const tk of segs)
    for (let i = 0; i < tk.length; i++) {
      const hit = idx.find((a) => a.toks.every((t, k) => tk[i + k]?.t === t));
      if (!hit) continue;
      const j = i + hit.toks.length;
      if (isNum(tk[j]?.t ?? "")) after++;
      if (isNum(tk[i - 1]?.t ?? "") || (UNITS[tk[i - 1]?.t ?? ""] && isNum(tk[i - 2]?.t ?? ""))) before++;
      i = j - 1;
    }
  return after > before;
}

const show = (toks: Tok[]) =>
  toks
    .map((x) => (x.t === PLUS ? "+" : x.o))
    .join(" ")
    .replace(/ \+ /g, "+")
    .slice(0, 80);

/**
 * Đọc tin nhắn nhận hàng / tồn kho → các món + số lượng.
 *   "nhận 5mn, 2nl, 3 bột na"   → Mini 5 hộp · Ngàn lớp 2 bánh · Bột năng 3
 *   "sầu múi 2kg" / "2kg sầu múi" / "mini x5"
 *   kem: "Kem dâu 1+194" → 1 hộp + 194 g
 * Tự nhận ra quy luật của tin:
 *   - kiểu "TÊN SỐ" (tồn kho): món không có số → báo "thiếu số lượng" (không tự cho 1);
 *     số đứng sau chữ lạ ("sầu 8", "XX 19") → báo chưa hiểu cả cụm, KHÔNG gán sang món kế tiếp.
 *   - kiểu "SỐ TÊN" / không ghi số ("nhận mini, bơ"): món không có số → 1.
 */
export function parseGoodsText(text: string, catalog: GoodsItem[] = DEFAULT_GOODS): { lines: GoodsLine[]; unknown: string[] } {
  const idx = aliasIndex(catalog);
  type L = GoodsLine & { open?: boolean; iu?: string; drop?: boolean };
  const lines: L[] = [];
  const unknown: string[] = [];
  const segs = String(text ?? "").split(SEG).map(segTokens);
  const strict = nameFirst(segs, idx);
  for (const tk of segs) {
    let pending: Part[] | null = null;
    let open: L | null = null; // món vừa gặp chưa có số → số đứng sau là của nó
    let buf: Tok[] = []; // chữ lạ chưa thuộc món nào (kiểu "TÊN SỐ")
    let bufJunk = 0;
    const give = (line: L, parts: Part[]) => {
      const [first, ...rest] = resolveQty(line.name, line.iu ?? "", parts);
      line.qty = first.qty;
      line.unit = first.unit;
      line.open = false;
      for (const r of rest) lines.push({ name: line.name, ...r });
    };
    // kiểu "TÊN SỐ": món đang chờ số mà gặp món khác / chữ lạ / hết đoạn → thiếu số lượng
    const closeMissing = () => {
      if (strict && open?.open) {
        open.drop = true;
        unknown.push(`${open.name} – thiếu số lượng`);
      }
      open = null;
    };
    const flushBuf = (extra: Tok[] = []) => {
      if (bufJunk || extra.length) {
        const s = show([...buf, ...extra]);
        if (s) unknown.push(s);
      }
      buf = [];
      bufJunk = 0;
    };
    let found = 0;
    let junk = 0;
    for (let i = 0; i < tk.length; i++) {
      const hit = idx.find((a) => a.toks.every((t, k) => tk[i + k]?.t === t));
      if (hit) {
        closeMissing();
        if (strict) flushBuf();
        const line: L = { name: hit.item.name, qty: NaN, unit: hit.item.unit, open: !pending, iu: hit.item.unit };
        lines.push(line);
        if (pending) give(line, pending);
        open = pending ? null : line;
        pending = null;
        found++;
        i += hit.toks.length - 1;
        continue;
      }
      if (isNum(tk[i].t)) {
        const start = i;
        const read = (): Part => {
          const q = Number(tk[i].t);
          const u = UNITS[tk[i + 1]?.t ?? ""];
          // "2 hop nhua mini": "hop" là đầu tên món → không ăn làm đơn vị
          const unitIsItem = u && idx.some((a) => a.toks.every((t, k) => tk[i + 1 + k]?.t === t));
          const unit = u && !unitIsItem ? u : "";
          if (unit) i++;
          return { q, unit };
        };
        const parts = [read()];
        // "1+245" / "1h + 245g"
        while (tk[i + 1]?.t === PLUS && isNum(tk[i + 2]?.t ?? "")) {
          i += 2;
          parts.push(read());
        }
        if (open) {
          give(open, parts);
          open = null;
        } else if (strict) flushBuf(tk.slice(start, i + 1)); // "sầu 8" / "XX 19": số của chữ lạ – không gán sang món sau
        else pending = parts;
        continue;
      }
      if (tk[i].t === PLUS) continue;
      if (tk[i].t === "het") {
        // "hết sầu múi" / "sầu múi hết" → còn 0 (báo tồn kho)
        if (open) {
          give(open, [{ q: 0, unit: "" }]);
          open = null;
        } else pending = [{ q: 0, unit: "" }];
        continue;
      }
      if (UNITS[tk[i].t] || FILLER.has(tk[i].t)) {
        if (strict && buf.length) buf.push(tk[i]);
        continue;
      }
      junk++;
      if (strict) {
        closeMissing();
        buf.push(tk[i]);
        bufJunk++;
      }
    }
    closeMissing();
    if (strict) flushBuf();
    else if (!found && (junk || pending)) {
      const raw = show(tk);
      // chỉ có chữ "nhận …" không kèm món → bỏ qua, không báo lỗi
      if (raw && junk) unknown.push(raw);
    }
  }
  return {
    lines: mergeLines(lines.filter((l) => !l.drop).map(({ name, qty, unit }) => ({ name, qty: Number.isNaN(qty) ? 1 : qty, unit: unit || autoUnit(name, Number.isNaN(qty) ? 1 : qty) }))),
    unknown,
  };
}

/**
 * Món đếm theo cái / quả / chai / gói… – số lượng thường nhỏ: > 50 cần xem lại, > 200 là bất thường (gõ nhầm / lẫn sang gam).
 * Không áp dụng khi ghi theo gam / ml.
 */
const COUNTED = new Set(["xuc xich", "nuoc dua", "mit", "xoai", "dua hau", "thanh long", "rick", "ambie", "sua dac", "bot mi"]);
export type QtyAlert = "high" | "abnormal";
export function qtyAlert(l: GoodsLine): QtyAlert | null {
  if (!COUNTED.has(foldGoods(l.name)) || /^(g|gr|gam|ml)$/i.test(foldGoods(l.unit ?? ""))) return null;
  return l.qty > 200 ? "abnormal" : l.qty > 50 ? "high" : null;
}
export const qtyAlertText = (a: QtyAlert) => (a === "abnormal" ? "Bất thường (> 200)" : "Số lớn (> 50) – xem lại");

/** Gộp món trùng (cùng tên + đơn vị) */
export function mergeLines(lines: GoodsLine[]): GoodsLine[] {
  const out: GoodsLine[] = [];
  for (const l of lines) {
    const same = out.find((x) => x.name === l.name && x.unit === l.unit);
    if (same) same.qty = Math.round((same.qty + l.qty) * 1000) / 1000;
    else out.push({ ...l });
  }
  return out;
}

/** Có chữ "nhận" (kể cả gõ sai dấu: nhạn, nhan, nhân) */
export const hasReceiveWord = (s: string) => /\bnhan\b/.test(foldGoods(s));

export const qtyVi = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 3 });
/** "Mini: 5 hộp" · tồn kho 0 → "Mini: hết" */
export const lineVi = (l: GoodsLine) => (l.qty === 0 ? `${l.name}: hết` : `${l.name}: ${qtyVi(l.qty)}${l.unit ? ` ${l.unit}` : ""}`);

/** RECEIVE = nhận hàng · RETURN = trả hàng (số lượng TRỪ vào hàng nhập) · STOCK = tồn kho */
export type GoodsKind = "RECEIVE" | "RETURN" | "STOCK";
/** lý do trả hàng gợi ý (nhân viên / admin chọn hoặc gõ) */
export const RETURN_REASONS = ["Hỏng / hư", "Hết hạn", "Giao nhầm", "Giao thừa", "Chuyển cơ sở khác"];
/** lọc Mongo theo loại: nhận hàng gồm cả bản ghi cũ chưa có kind */
export const kindFilter = (k: GoodsKind) => (k === "RECEIVE" ? { $nin: ["STOCK", "RETURN"] } : k);

/** Tin nhắn gửi nhóm Telegram cơ sở */
/** "2026-11-10" → "10/11 (Thứ 3)" – không cần năm */
export function dayVi(date: string) {
  const w = new Date(`${date}T00:00:00Z`).getUTCDay();
  return `${date.slice(8, 10)}/${date.slice(5, 7)} (${w === 0 ? "CN" : `Thứ ${w + 1}`})`;
}

/** Dòng đầu tin Telegram: 📦 NHẬN HÀNG · cơ sở · 10/11 (Thứ 3) */
export const goodsHeader = (r: { store: string; date: string; edited?: boolean; kind?: GoodsKind }) =>
  `${r.kind === "STOCK" ? "📋" : r.kind === "RETURN" ? "↩️" : "📦"} ${r.edited ? "SỬA " : ""}${r.kind === "STOCK" ? "TỒN KHO" : r.kind === "RETURN" ? "TRẢ HÀNG" : "NHẬN HÀNG"} · ${r.store} · ${dayVi(r.date)}`;

/**
 * Tin Telegram: chỉ cần NỘI DUNG GỐC (chữ nhân viên gõ). Không có nội dung gốc (chọn tay) hoặc admin sửa số → liệt kê món.
 */
export function goodsMessage(r: { store: string; date: string; by: string; lines: GoodsLine[]; note?: string; raw?: string; sender?: string; edited?: boolean; kind?: GoodsKind; reason?: string }) {
  const raw = r.raw?.trim();
  const ret = r.kind === "RETURN";
  return [
    goodsHeader(r),
    `👤 ${r.by}${r.sender && r.sender !== r.by ? ` (báo: ${r.sender})` : ""}`,
    // trả hàng: luôn liệt kê món với dấu − + lý do (trừ vào hàng nhập)
    ...(ret ? r.lines.map((l) => `• −${lineVi(l).replace(/^(.*?): /, "$1: ")}`) : raw && !r.edited ? [raw] : r.lines.map((l) => `• ${lineVi(l)}`)),
    ...(ret && r.reason ? [`❓ Lý do: ${r.reason}`] : []),
    ...(r.note ? [`📝 ${r.note}`] : []),
  ].join("\n");
}

/** Chuẩn hoá danh sách món gửi lên: chỉ món trong danh mục, số lượng hợp lệ (tồn kho: cho phép 0 = hết). */
export function cleanLines(input: unknown, catalog: GoodsItem[], allowZero = false): GoodsLine[] {
  const byKey = new Map(catalog.map((c) => [foldGoods(c.name), c]));
  const arr = Array.isArray(input) ? input : [];
  const out: GoodsLine[] = [];
  for (const x of arr.slice(0, 100)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const item = byKey.get(foldGoods(String(o.name ?? "")));
    const qty = Math.round(Number(o.qty) * 1000) / 1000;
    if (!item || !Number.isFinite(qty) || qty < 0 || (qty === 0 && !allowZero) || qty > 100_000) continue;
    let unit = String(o.unit ?? item.unit ?? "").trim().slice(0, 20);
    // kem không ghi đơn vị: < 100 = hộp, ≥ 100 = gam
    if (!unit) unit = autoUnit(item.name, qty);
    out.push({ name: item.name, qty, unit });
  }
  return mergeLines(out);
}

/** Hai lần nhận giống hệt nhau (cùng món + số) – để báo "có vẻ đã nhập rồi" */
export const sameLines = (a: GoodsLine[], b: GoodsLine[]) => {
  const key = (l: GoodsLine[]) => l.map((x) => `${foldGoods(x.name)}=${x.qty}${foldGoods(x.unit ?? "")}`).sort().join("|");
  return a.length > 0 && key(a) === key(b);
};

/* ---------- Giá nhập + tổng hợp tiêu thụ ---------- */
export type PriceEntry = { from: string; price: number };

/** Giá áp dụng ngày `date`: mốc gần nhất có from ≤ date; ngày trước mốc đầu tiên → giá mốc đầu tiên. */
export function priceAt(prices: PriceEntry[] | undefined, date: string): number | null {
  const ps = (prices ?? []).filter((p) => p.from && p.price >= 0).slice().sort((a, b) => a.from.localeCompare(b.from));
  if (!ps.length) return null;
  let hit = ps[0];
  for (const p of ps) if (p.from <= date) hit = p;
  return hit.price;
}

export type UsageRec = { kind: GoodsKind; date: string; at: number; lines: GoodsLine[] };
export type UsageRow = {
  name: string;
  unit: string;
  /** "stock" = tồn đầu + nhập − tồn cuối · "receive" = chỉ theo số nhập (chưa đủ 2 lần kiểm kho) */
  mode: "stock" | "receive";
  open?: { date: string; qty: number };
  close?: { date: string; qty: number };
  received: number;
  /** hàng nhập TRONG THÁNG (ngày from → to) – ĐÃ TRỪ hàng trả; số lượng & tiền theo giá ngày nhận; null = chưa có giá */
  monthReceived: number;
  /** hàng trả trong tháng (số dương) – đã trừ trong monthReceived */
  monthReturned: number;
  receivedValue: number | null;
  usage: number;
  /** thành tiền tiêu thụ; null = chưa có giá */
  value: number | null;
  price: number | null;
  /** số dòng ghi khác đơn vị tính giá → không cộng */
  skipped: number;
};

const sameUnit = (a: string, b: string) => foldGoods(a) === foldGoods(b);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Tiêu thụ 1 cơ sở trong kỳ [from, to] cho từng món.
 * Có tồn kho: lần kiểm gần nhất TRƯỚC kỳ (tồn đầu) và lần kiểm cuối TRONG kỳ (tồn cuối) → tiêu thụ = đầu + nhập giữa 2 lần kiểm − cuối
 *   (kiểm kho tính là số còn CUỐI NGÀY → hàng nhận cùng ngày kiểm đầu không cộng, cùng ngày kiểm cuối có cộng).
 * Không đủ tồn kho: tiêu thụ = số nhập trong kỳ.
 * Thành tiền = đầu × giá ngày đầu + Σ nhập × giá ngày nhập − cuối × giá ngày cuối (giá tăng giữa tháng tính đúng).
 */
export function usageReport(input: { from: string; to: string; items: (GoodsItem & { prices?: PriceEntry[] })[]; recs: UsageRec[]; useStock: boolean }): UsageRow[] {
  const { from, to } = input;
  const out: UsageRow[] = [];
  const recs = input.recs.slice().sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at);
  for (const it of input.items) {
    const key = foldGoods(it.name);
    let skipped = 0;
    const qtyOf = (r: UsageRec) => {
      let q: number | null = null;
      for (const l of r.lines)
        if (foldGoods(l.name) === key) {
          if (!sameUnit(l.unit ?? "", it.unit)) {
            skipped++;
            continue;
          }
          q = (q ?? 0) + l.qty;
        }
      return q;
    };
    const counts = input.useStock ? recs.filter((r) => r.kind === "STOCK").map((r) => ({ r, q: qtyOf(r) })).filter((x) => x.q != null) : [];
    const before = counts.filter((x) => x.r.date < from).pop();
    const inside = counts.filter((x) => x.r.date >= from && x.r.date <= to).pop();
    // nhận hàng (+) và trả hàng (−): trả hàng trừ thẳng vào số nhập
    const recv = recs.filter((r) => r.kind === "RECEIVE" || r.kind === "RETURN");
    const sign = (r: UsageRec) => (r.kind === "RETURN" ? -1 : 1);
    skipped = 0; // chỉ đếm dòng lệch đơn vị ở hàng nhận trong kỳ
    let mode: UsageRow["mode"] = "receive";
    let lo = from;
    let hi = to;
    let incl = (d: string) => d >= lo && d <= hi;
    if (before && inside) {
      mode = "stock";
      lo = before.r.date;
      hi = inside.r.date;
      incl = (d) => d > lo && d <= hi;
    }
    let received = 0;
    let value: number | null = 0;
    for (const r of recv) {
      if (!incl(r.date)) continue;
      const q0 = qtyOf(r);
      if (q0 == null) continue;
      const q = q0 * sign(r);
      received += q;
      const p = priceAt(it.prices, r.date);
      value = p == null || value == null ? null : value + q * p;
    }
    // tiền hàng nhập trong tháng (không phụ thuộc lần kiểm kho) – dòng lệch đơn vị chỉ đếm ở đây
    skipped = 0;
    let monthReceived = 0;
    let monthReturned = 0;
    let receivedValue: number | null = 0;
    for (const r of recv) {
      if (r.date < from || r.date > to) continue;
      const q0 = qtyOf(r);
      if (q0 == null) continue;
      const qy = q0 * sign(r);
      if (r.kind === "RETURN") monthReturned += q0;
      monthReceived += qy;
      const p = priceAt(it.prices, r.date);
      receivedValue = p == null || receivedValue == null ? null : receivedValue + qy * p;
    }
    let usage = received;
    if (mode === "stock") {
      usage = before!.q! + received - inside!.q!;
      const p0 = priceAt(it.prices, before!.r.date);
      const p1 = priceAt(it.prices, inside!.r.date);
      value = value == null || p0 == null || p1 == null ? null : value + before!.q! * p0 - inside!.q! * p1;
    }
    if (!received && !monthReceived && mode === "receive" && !skipped) continue;
    if (mode === "stock" && !received && !usage && !monthReceived) continue;
    out.push({
      name: it.name,
      unit: it.unit,
      mode,
      open: mode === "stock" ? { date: before!.r.date, qty: before!.q! } : undefined,
      close: mode === "stock" ? { date: inside!.r.date, qty: inside!.q! } : undefined,
      received: r3(received),
      monthReceived: r3(monthReceived),
      monthReturned: r3(monthReturned),
      receivedValue: receivedValue == null ? null : Math.round(receivedValue),
      usage: r3(usage),
      value: value == null ? null : Math.round(value),
      price: priceAt(it.prices, to),
      skipped,
    });
  }
  return out;
}
