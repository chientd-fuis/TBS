import ExcelJS from "exceljs";
import { connectDB } from "./db";
import { ShiftClosing, Store } from "./models";
import { parseMoney, sortClosings } from "./revenue";
import { fold } from "./revenue-gap";
import { DEFAULT_TZ, localDate } from "./time";

/*
 * Import DOANH THU MÁY từ báo cáo KiotViet "Báo cáo bán hàng theo thời gian" (.xlsx / .xls dạng HTML / .csv / .pdf).
 * Lấy cột Thời gian (dd/mm/yyyy) + Doanh thu → ghi vào DT máy của lượt chốt ca CUỐI NGÀY (ca Tối) từng ngày.
 * Doanh thu ngày (Tài chính) tự tính lại theo, và ngày thiếu tiền tự tạo yêu cầu bù doanh thu (lib/revenue-gap.ts).
 */

export type ParsedReport = { branch: string; from?: string; to?: string; rows: { date: string; dt: number }[]; total?: number };

const ymd = (d: string) => {
  const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(d);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};

/** Bảng chữ (mỗi dòng = các ô) → báo cáo. Cột doanh thu = cột có tiêu đề "Doanh thu" (không phải "thuần"), không thấy → số đầu tiên sau ngày. */
export function parseTable(table: string[][]): ParsedReport {
  let branch = "";
  let from: string | undefined;
  let to: string | undefined;
  let col = -1;
  let total: number | undefined;
  const rows: { date: string; dt: number }[] = [];
  for (const r of table) {
    const cells = r.map((c) => String(c ?? "").replace(/\s+/g, " ").trim());
    const line = cells.join(" ");
    const b = /chi nh[aá]nh\s*:\s*(.+)/i.exec(line);
    if (b && !branch) branch = b[1].trim();
    const range = /t[uừ] ng[aà]y\s*(\d{1,2}\/\d{1,2}\/\d{4}).*?đ[eế]n ng[aà]y\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(line);
    if (range) [from, to] = [ymd(range[1]) ?? undefined, ymd(range[2]) ?? undefined];
    const hi = cells.findIndex((c) => fold(c) === "doanh thu");
    if (hi >= 0 && col < 0) {
      col = hi;
      continue;
    }
    const di = cells.findIndex((c) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(c));
    const nums = (start: number) => cells.slice(start).map((c) => parseMoney(c)).filter((x): x is number => x != null);
    if (di < 0) {
      // dòng tổng (không có ngày, chỉ có số) ngay dưới tiêu đề
      if (col >= 0 && total == null && !rows.length) {
        // ô gộp (.xls KiotViet): số tổng có thể lệch cột so với tiêu đề → lấy số đầu tiên của dòng
        const v = parseMoney(cells[col] ?? "") ?? nums(0)[0] ?? null;
        if (v != null && v > 0) total = v;
      }
      continue;
    }
    const date = ymd(cells[di]);
    if (!date) continue;
    let v = col > di ? parseMoney(cells[col] ?? "") : null;
    if (v == null) v = nums(di + 1)[0] ?? null;
    if (v != null && v >= 0) rows.push({ date, dt: v });
  }
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.date, r.dt); // trùng ngày → lấy dòng sau
  return { branch, from, to, total, rows: [...seen.entries()].map(([date, dt]) => ({ date, dt })).sort((a, b) => a.date.localeCompare(b.date)) };
}

function htmlTable(html: string): string[][] {
  const decode = (s: string) =>
    s
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .trim();
  return html.split(/<\/tr>/i).map((tr) => tr.split(/<\/t[dh]>/i).map(decode).filter((_, i, a) => i < a.length - 1 || a[i] !== ""));
}

/** Đọc file → báo cáo. PDF đọc bằng Gemini (cần bật AI). */
export async function parseRevenueFile(name: string, buf: Buffer, actor: string): Promise<ParsedReport> {
  const head = buf.subarray(0, 8);
  const lower = name.toLowerCase();
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const table: string[][] = [];
    wb.worksheets[0]?.eachRow({ includeEmpty: false }, (row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => {
        if (v instanceof Date) return `${String(v.getUTCDate()).padStart(2, "0")}/${String(v.getUTCMonth() + 1).padStart(2, "0")}/${v.getUTCFullYear()}`;
        if (v && typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result ?? "");
        if (v && typeof v === "object" && "richText" in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
        return String(v ?? "");
      });
      table.push(vals);
    });
    return parseTable(table);
  }
  if (head[0] === 0xd0 && head[1] === 0xcf) {
    // .xls Excel cũ (BIFF8) – KiotViet xuất "BigSaleByTime.xls" dạng này
    const { readXlsTable } = await import("./xls-biff");
    return parseTable(readXlsTable(buf));
  }
  if (lower.endsWith(".pdf") || (head[0] === 0x25 && head[1] === 0x50)) {
    const { geminiGenerate, ocrConfigured } = await import("./ocr");
    if (!ocrConfigured()) throw new Error("Đọc PDF cần bật AI (Gemini) – dùng file .xlsx / .xls thay thế.");
    const out = await geminiGenerate({
      prompt:
        'Đây là "Báo cáo bán hàng theo thời gian" của KiotViet. Trả JSON {"branch": tên chi nhánh, "rows": [{"date": "dd/mm/yyyy", "revenue": số Doanh thu (cột Doanh thu, số nguyên VND)}]} – mỗi ngày 1 dòng, bỏ dòng tổng. Không bịa số.',
      photos: [`data:application/pdf;base64,${buf.toString("base64")}`],
      feature: "closingOcr",
      actor,
      timeoutMs: 60_000,
    });
    const j = JSON.parse(String(out ?? "").replace(/^```(?:json)?|```$/g, "").trim()) as { branch?: string; rows?: { date: string; revenue: unknown }[] };
    return parseTable([[`Chi nhánh: ${j.branch ?? ""}`], ["Thời gian", "Doanh thu"], ...(j.rows ?? []).map((r) => [r.date, String(r.revenue)])]);
  }
  const text = buf.toString("utf8").replace(/^﻿/, "");
  if (/<t[dr][\s>]/i.test(text)) return parseTable(htmlTable(text));
  return parseTable(text.split(/\r?\n/).map((l) => l.split(/[\t;,](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, ""))));
}

export type ImportRow = {
  date: string;
  dt: number;
  cur: number | null;
  status: "update" | "same" | "noEvening" | "today" | "outside";
  closingId?: string;
  shiftName?: string;
  who?: string;
};

/** So file với DT máy đang có của ca cuối ngày. today: bỏ qua ngày hôm nay trừ khi includeToday. fallback: ghi vào ca gần nhất khi chưa có ca Tối. */
export async function compareImport(storeId: string, rows: { date: string; dt: number }[], opts: { includeToday: boolean; fallbackLatest: boolean }) {
  await connectDB();
  const store = await Store.findById(storeId).select("timezone").lean();
  const today = localDate(new Date(), store?.timezone || DEFAULT_TZ);
  const closings = await ShiftClosing.find({ storeId, workDate: { $in: rows.map((r) => r.date) } })
    .select("workDate shiftName isDayEnd revenue employeeName createdAt")
    .lean();
  const out: ImportRow[] = [];
  for (const r of rows) {
    if (r.date > today) continue;
    const day = sortClosings(closings.filter((c) => c.workDate === r.date));
    const evening = [...day].reverse().find((c) => c.isDayEnd) ?? null;
    const target = evening ?? (opts.fallbackLatest ? (day[day.length - 1] ?? null) : null);
    const cur = target?.revenue?.dt ?? null;
    const base = { date: r.date, dt: r.dt, cur, closingId: target ? String(target._id) : undefined, shiftName: target?.shiftName ?? undefined, who: target?.employeeName ?? undefined };
    if (r.date === today && !opts.includeToday) out.push({ ...base, status: "today" });
    else if (!target) out.push({ ...base, status: "noEvening" });
    else out.push({ ...base, status: cur === r.dt ? "same" : "update" });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
