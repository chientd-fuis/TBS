import { auth, sheets as sheetsApi } from "@googleapis/sheets";
import { sheetLayoutOf, sheetRowCells, sheetRowOf, sheetTabName, type Revenue } from "./revenue";

/*
 * Ghi doanh thu ngày vào Google Sheet của cơ sở bằng SERVICE ACCOUNT
 * (share file sheet cho email service account với quyền Người chỉnh sửa).
 * Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (dán nguyên private_key trong file JSON, giữ "\n").
 * Mẫu cột theo cơ sở – xem sheetRowCells (revenue.ts). Các cột công thức (Chênh lệch, DT thực tế) không ghi.
 * cột G (Chênh lệch), H (DT thực tế) giữ công thức sẵn có trong sheet.
 */

/**
 * Đọc thông tin service account từ env, chịu được các kiểu dán hay gặp trên Vercel / .env:
 * - GOOGLE_SA_JSON: dán NGUYÊN nội dung file JSON (hoặc base64 của file) – khuyên dùng
 * - GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY: key có thể còn dấu " bao quanh, "\n" dạng chữ, xuống dòng Windows…
 */
export function serviceAccount(): { email: string; key: string } | null {
  const parseJson = (raw: string) => {
    const t = raw.trim();
    const text = t.startsWith("{") ? t : Buffer.from(t, "base64").toString("utf8");
    const j = JSON.parse(text) as { client_email?: string; private_key?: string };
    return j.client_email && j.private_key ? { email: j.client_email, key: j.private_key } : null;
  };
  try {
    if (process.env.GOOGLE_SA_JSON) {
      const r = parseJson(process.env.GOOGLE_SA_JSON);
      if (r) return { email: r.email, key: normalizePrivateKey(r.key) };
    }
    const email = process.env.GOOGLE_SA_EMAIL?.trim().replace(/^["']|["']$/g, "");
    let key = process.env.GOOGLE_SA_PRIVATE_KEY;
    if (!key) return null;
    // lỡ dán cả file JSON vào ô private key
    if (key.trim().startsWith("{")) {
      const r = parseJson(key);
      if (r) return { email: email || r.email, key: normalizePrivateKey(r.key) };
    }
    key = normalizePrivateKey(key);
    return email ? { email, key } : null;
  } catch {
    return null;
  }
}

/** Chuẩn hoá private key PEM: bỏ dấu nháy bao quanh, đổi "\n" dạng chữ thành xuống dòng, bỏ \r, nhận cả base64. */
export function normalizePrivateKey(raw: string) {
  let k = raw.trim().replace(/^["']+|["']+$/g, "").replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\r/g, "");
  if (!k.includes("BEGIN") && /^[A-Za-z0-9+/=\s]+$/.test(k)) {
    const dec = Buffer.from(k, "base64").toString("utf8");
    if (dec.includes("BEGIN")) k = dec;
  }
  // dán thành 1 dòng có dấu cách thay cho xuống dòng → dựng lại PEM
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/.exec(k);
  if (m) {
    const body = m[2].replace(/\s+/g, "");
    k = `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END ${m[1]}-----\n`;
  }
  return k;
}

export const sheetsConfigured = () => !!serviceAccount();

function client() {
  const sa = serviceAccount();
  if (!sa) throw new Error("Chưa cấu hình service account Google (GOOGLE_SA_JSON hoặc GOOGLE_SA_EMAIL + GOOGLE_SA_PRIVATE_KEY)");
  const jwt = new auth.JWT({ email: sa.email, key: sa.key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  return sheetsApi({ version: "v4", auth: jwt });
}

type SheetCfg = {
  revenueSheetId?: string | null;
  revenueTabPattern?: string | null;
  revenueFirstRow?: number | null;
  revenueSheetLayout?: string | null;
  name?: string | null;
};

export function dayRange(cfg: SheetCfg, date: string) {
  const tab = sheetTabName(cfg.revenueTabPattern || "T{m}", date.slice(0, 7));
  const row = sheetRowOf(date, cfg.revenueFirstRow || 3);
  return { tab, row };
}

/** Ghi 1 ngày. Trả về vùng đã ghi, VD "'T11'!B9:F9". */
export async function writeDayRow(cfg: SheetCfg, date: string, r: Revenue, note: string) {
  if (!cfg.revenueSheetId) throw new Error("Cơ sở chưa gắn Google Sheet doanh thu");
  const { tab, row } = dayRange(cfg, date);
  const api = client();
  const q = `'${tab.replace(/'/g, "''")}'`;
  // mẫu cột theo cơ sở (Geleximco / cơ sở mới có cột Grab; cơ sở cũ dùng mẫu cũ)
  const cells = sheetRowCells(sheetLayoutOf(cfg), row, r, note);
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: cfg.revenueSheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: cells.map((c) => ({ range: `${q}!${c.range}`, values: c.values })),
    },
  });
  return `${q}!${cells[0].range}`;
}

/** Kiểm tra quyền + tab của tháng hiện tại (nút "Kiểm tra" ở trang Cơ sở). */
export async function checkSheet(cfg: SheetCfg, month: string) {
  if (!cfg.revenueSheetId) throw new Error("Chưa nhập Google Sheet");
  const api = client();
  const meta = await api.spreadsheets.get({ spreadsheetId: cfg.revenueSheetId, fields: "properties.title,sheets.properties.title" });
  const tabs = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "");
  const tab = sheetTabName(cfg.revenueTabPattern || "T{m}", month);
  return { title: meta.data.properties?.title ?? "", tabs, tab, hasTab: tabs.includes(tab) };
}
