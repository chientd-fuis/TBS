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
  ["Kem scl", "", "kem socola, kem sô cô la, kem chocolate"],
  ["Kem cv", "", ""],
  ["Xúc xích", "", ""],
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
  "nhan nhap da nhan hang do hom nay sang chieu toi nay ve them va voi cua gom co duoc roi a nhe nha oke ok em anh chi e a ah luc gio ngay x so luong sl tong la".split(" "),
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

/**
 * Đọc tin nhắn nhận hàng → các món + số lượng.
 *   "nhận 5mn, 2nl, 3 bột na"   → Mini 5 hộp · Ngàn lớp 2 bánh · Bột năng 3
 *   "sầu múi 2kg" / "2kg sầu múi" / "mini x5"
 * Món không có số → 1. Đoạn không hiểu → unknown (nguyên văn) để người nhập sửa / nhờ AI.
 */
export function parseGoodsText(text: string, catalog: GoodsItem[] = DEFAULT_GOODS): { lines: GoodsLine[]; unknown: string[] } {
  const idx = aliasIndex(catalog);
  const lines: (GoodsLine & { open?: boolean })[] = [];
  const unknown: string[] = [];
  // tách theo dấu phẩy / xuống dòng / + / ;  (giữ "1,5kg")
  for (const seg of String(text ?? "").split(/(?<!\d),|,(?!\d)|[;\n+]+|\s[-–]\s/)) {
    const tk = tokens(seg);
    let pending: { qty: number; unit: string } | null = null;
    let open: (GoodsLine & { open?: boolean }) | null = null; // món vừa gặp chưa có số → số đứng sau là của nó
    let found = 0;
    let junk = 0;
    for (let i = 0; i < tk.length; i++) {
      const hit = idx.find((a) => a.toks.every((t, k) => tk[i + k] === t));
      if (hit) {
        const line = { name: hit.item.name, qty: pending?.qty ?? 0, unit: pending?.unit || hit.item.unit, open: !pending };
        lines.push(line);
        open = pending ? null : line;
        pending = null;
        found++;
        i += hit.toks.length - 1;
        continue;
      }
      if (isNum(tk[i])) {
        const q = Number(tk[i]);
        const u = UNITS[tk[i + 1] ?? ""];
        // "2 hop nhua mini": "hop" là đầu tên món → không ăn làm đơn vị
        const unitIsItem = u && idx.some((a) => a.toks.every((t, k) => tk[i + 1 + k] === t));
        const unit = u && !unitIsItem ? u : "";
        if (unit) i++;
        if (open) {
          open.qty = q;
          if (unit) open.unit = unit;
          open.open = false;
          open = null;
        } else pending = { qty: q, unit };
        continue;
      }
      if (UNITS[tk[i]] || FILLER.has(tk[i])) continue;
      junk++;
    }
    if (!found && (junk || pending)) {
      const raw = seg.trim();
      // chỉ có chữ "nhận …" không kèm món → bỏ qua, không báo lỗi
      if (raw && junk) unknown.push(raw.slice(0, 80));
    }
  }
  return { lines: mergeLines(lines.map(({ name, qty, unit }) => ({ name, qty: qty > 0 ? qty : 1, unit }))), unknown };
}

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
export const lineVi = (l: GoodsLine) => `${l.name}: ${qtyVi(l.qty)}${l.unit ? ` ${l.unit}` : ""}`;

/** Tin nhắn gửi nhóm Telegram cơ sở */
export function goodsMessage(r: { store: string; date: string; by: string; lines: GoodsLine[]; note?: string; edited?: boolean }) {
  const d = `${r.date.slice(8, 10)}/${r.date.slice(5, 7)}/${r.date.slice(0, 4)}`;
  return [
    `📦 ${r.edited ? "SỬA " : ""}NHẬN HÀNG · ${r.store} · ${d}`,
    `👤 ${r.by}`,
    ...r.lines.map((l) => `• ${lineVi(l)}`),
    ...(r.note ? [`📝 ${r.note}`] : []),
  ].join("\n");
}

/** Chuẩn hoá danh sách món gửi lên: chỉ món trong danh mục, số lượng hợp lệ. */
export function cleanLines(input: unknown, catalog: GoodsItem[]): GoodsLine[] {
  const byKey = new Map(catalog.map((c) => [foldGoods(c.name), c]));
  const arr = Array.isArray(input) ? input : [];
  const out: GoodsLine[] = [];
  for (const x of arr.slice(0, 100)) {
    const o = (x ?? {}) as Record<string, unknown>;
    const item = byKey.get(foldGoods(String(o.name ?? "")));
    const qty = Math.round(Number(o.qty) * 1000) / 1000;
    if (!item || !Number.isFinite(qty) || qty <= 0 || qty > 100_000) continue;
    out.push({ name: item.name, qty, unit: String(o.unit ?? item.unit ?? "").trim().slice(0, 20) });
  }
  return mergeLines(out);
}

/** Hai lần nhận giống hệt nhau (cùng món + số) – để báo "có vẻ đã nhập rồi" */
export const sameLines = (a: GoodsLine[], b: GoodsLine[]) => {
  const key = (l: GoodsLine[]) => l.map((x) => `${foldGoods(x.name)}=${x.qty}`).sort().join("|");
  return a.length > 0 && key(a) === key(b);
};
