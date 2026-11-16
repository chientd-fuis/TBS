/*
 * Đọc file Excel CŨ (.xls – BIFF8 trong OLE Compound File) → bảng chữ của SHEET ĐẦU TIÊN.
 * Dùng cho báo cáo KiotViet ("BigSaleByTime.xls"). Không cần thư viện ngoài.
 * Hỗ trợ: chuỗi chung (SST + CONTINUE), LABELSST, LABEL, NUMBER, RK, MULRK, FORMULA (+ STRING).
 */

const END = 0xfffffffa; // >= : hết chuỗi sector

function readCfbStream(buf: Buffer, names: string[]): Buffer {
  if (buf.readUInt32LE(0) !== 0xe011cfd0) throw new Error("Không phải file Excel .xls");
  const secSize = 1 << buf.readUInt16LE(30);
  const miniSize = 1 << buf.readUInt16LE(32);
  const dirStart = buf.readUInt32LE(48);
  const cutoff = buf.readUInt32LE(56);
  const miniFatStart = buf.readUInt32LE(60);
  let difatSec = buf.readUInt32LE(68);
  const sec = (id: number) => buf.subarray((id + 1) * secSize, (id + 2) * secSize);

  // FAT: 109 mục DIFAT trong header + chuỗi DIFAT
  const fatSecs: number[] = [];
  for (let i = 0; i < 109; i++) {
    const v = buf.readUInt32LE(76 + i * 4);
    if (v < END) fatSecs.push(v);
  }
  for (let guard = 0; difatSec < END && guard < 10000; guard++) {
    const s = sec(difatSec);
    for (let i = 0; i < secSize / 4 - 1; i++) {
      const v = s.readUInt32LE(i * 4);
      if (v < END) fatSecs.push(v);
    }
    difatSec = s.readUInt32LE(secSize - 4);
  }
  const fat: number[] = [];
  for (const f of fatSecs) {
    const s = sec(f);
    for (let i = 0; i < secSize / 4; i++) fat.push(s.readUInt32LE(i * 4));
  }
  const chain = (start: number, next: number[]) => {
    const out: number[] = [];
    for (let id = start; id < END && out.length < 1_000_000; id = next[id] ?? END) out.push(id);
    return out;
  };
  const readChain = (start: number) => Buffer.concat(chain(start, fat).map(sec));

  // thư mục
  const dir = readChain(dirStart);
  type Entry = { name: string; type: number; start: number; size: number };
  const entries: Entry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = dir.readUInt16LE(o + 64);
    entries.push({
      name: dir.subarray(o, o + Math.max(0, nl - 2)).toString("utf16le"),
      type: dir[o + 66],
      start: dir.readUInt32LE(o + 116),
      size: dir.readUInt32LE(o + 120),
    });
  }
  const e = entries.find((x) => x.type === 2 && names.includes(x.name));
  if (!e) throw new Error("File .xls không có dữ liệu bảng tính");
  if (e.size >= cutoff) return readChain(e.start).subarray(0, e.size);

  // luồng nhỏ (< 4096 byte) nằm trong mini stream của Root Entry
  const root = entries[0];
  const ministream = readChain(root.start);
  const miniFat: number[] = [];
  const mf = readChain(miniFatStart);
  for (let i = 0; i + 4 <= mf.length; i += 4) miniFat.push(mf.readUInt32LE(i));
  return Buffer.concat(chain(e.start, miniFat).map((id) => ministream.subarray(id * miniSize, (id + 1) * miniSize))).subarray(0, e.size);
}

function rk(v: number): number {
  let n: number;
  if (v & 2) n = v >> 2;
  else {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(0, 0);
    b.writeUInt32LE(v & 0xfffffffc, 4);
    n = b.readDoubleLE(0);
  }
  return v & 1 ? n / 100 : n;
}

const numText = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Đọc chuỗi BIFF8 ngắn trong 1 record (LABEL / STRING): cch u16, flags u8, ký tự */
function shortStr(d: Buffer, o: number): string {
  const cch = d.readUInt16LE(o);
  const hi = d[o + 2] & 1;
  return hi ? d.subarray(o + 3, o + 3 + cch * 2).toString("utf16le") : d.subarray(o + 3, o + 3 + cch).toString("latin1");
}

/** Bảng SST: chuỗi có thể vắt qua record CONTINUE (đầu mỗi CONTINUE có byte cờ mới cho phần ký tự). */
function parseSst(parts: Buffer[]): string[] {
  let pi = 0;
  let o = 8; // bỏ cstTotal, cstUnique
  const out: string[] = [];
  const cur = () => parts[pi];
  const ensure = () => {
    while (pi < parts.length && o >= cur().length) {
      pi++;
      o = 0;
    }
  };
  const u8 = () => (ensure(), cur()[o++]);
  const u16 = () => {
    ensure();
    if (o + 2 <= cur().length) {
      const v = cur().readUInt16LE(o);
      o += 2;
      return v;
    }
    return u8() | (u8() << 8);
  };
  const u32 = () => u16() + u16() * 65536;
  const skip = (n: number) => {
    while (n > 0) {
      ensure();
      if (pi >= parts.length) return;
      const k = Math.min(n, cur().length - o);
      o += k;
      n -= k;
    }
  };
  const total = parts[0].readUInt32LE(4);
  while (out.length < total) {
    ensure();
    if (pi >= parts.length) break;
    const cch = u16();
    const flags = u8();
    let hi = flags & 1;
    const runs = flags & 8 ? u16() : 0;
    const ext = flags & 4 ? u32() : 0;
    let s = "";
    let left = cch;
    while (left > 0) {
      if (o >= cur().length) {
        pi++;
        o = 0;
        if (pi >= parts.length) break;
        hi = cur()[o++] & 1; // CONTINUE: byte cờ mới
      }
      const avail = Math.floor((cur().length - o) / (hi ? 2 : 1));
      const k = Math.min(left, avail);
      s += hi ? cur().subarray(o, o + k * 2).toString("utf16le") : cur().subarray(o, o + k).toString("latin1");
      o += k * (hi ? 2 : 1);
      left -= k;
    }
    skip(runs * 4 + ext);
    out.push(s);
  }
  return out;
}

/** .xls (BIFF8) → các dòng của sheet đầu tiên (ô trống = ""). */
export function readXlsTable(buf: Buffer): string[][] {
  const wb = readCfbStream(buf, ["Workbook", "Book"]);
  const recs: { type: number; data: Buffer }[] = [];
  for (let o = 0; o + 4 <= wb.length; ) {
    const type = wb.readUInt16LE(o);
    const len = wb.readUInt16LE(o + 2);
    recs.push({ type, data: wb.subarray(o + 4, o + 4 + len) });
    o += 4 + len;
  }
  let sst: string[] = [];
  const grid = new Map<number, Map<number, string>>();
  const put = (r: number, c: number, v: string) => {
    if (!grid.has(r)) grid.set(r, new Map());
    grid.get(r)!.set(c, v);
  };
  let sheet = 0; // 0 = phần chung, 1 = sheet đầu tiên, 2 = đã xong
  let pendingFormula: [number, number] | null = null;
  for (let i = 0; i < recs.length && sheet < 2; i++) {
    const { type, data: d } = recs[i];
    if (type === 0x0809) {
      if (d.readUInt16LE(2) === 0x0010) sheet = sheet === 0 ? 1 : 2;
      continue;
    }
    if (type === 0x000a && sheet === 1) {
      sheet = 2;
      continue;
    }
    if (type === 0x00fc) {
      const parts = [d];
      while (recs[i + 1]?.type === 0x003c) parts.push(recs[++i].data);
      sst = parseSst(parts);
      continue;
    }
    if (sheet !== 1) continue;
    if (type === 0x00fd) put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? "");
    else if (type === 0x0204) put(d.readUInt16LE(0), d.readUInt16LE(2), shortStr(d, 6));
    else if (type === 0x0203) put(d.readUInt16LE(0), d.readUInt16LE(2), numText(d.readDoubleLE(6)));
    else if (type === 0x027e) put(d.readUInt16LE(0), d.readUInt16LE(2), numText(rk(d.readUInt32LE(6))));
    else if (type === 0x00bd) {
      const r = d.readUInt16LE(0);
      const c0 = d.readUInt16LE(2);
      const n = (d.length - 6) / 6;
      for (let k = 0; k < n; k++) put(r, c0 + k, numText(rk(d.readUInt32LE(4 + k * 6 + 2))));
    } else if (type === 0x0006) {
      const r = d.readUInt16LE(0);
      const c = d.readUInt16LE(2);
      if (d.readUInt16LE(12) === 0xffff) {
        if (d[6] === 0) pendingFormula = [r, c]; // kết quả chuỗi ở record STRING tiếp theo
      } else put(r, c, numText(d.readDoubleLE(6)));
    } else if (type === 0x0207 && pendingFormula) {
      put(pendingFormula[0], pendingFormula[1], shortStr(d, 0));
      pendingFormula = null;
    }
  }
  const rows = [...grid.keys()].sort((a, b) => a - b);
  return rows.map((r) => {
    const m = grid.get(r)!;
    const w = Math.max(...m.keys()) + 1;
    return Array.from({ length: w }, (_, c) => m.get(c) ?? "");
  });
}
