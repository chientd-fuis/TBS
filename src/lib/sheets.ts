import { auth, sheets as sheetsApi } from "@googleapis/sheets";
import { sheetRowOf, sheetTabName, type Revenue } from "./revenue";

/*
 * Ghi doanh thu ngày vào Google Sheet của cơ sở bằng SERVICE ACCOUNT
 * (share file sheet cho email service account với quyền Người chỉnh sửa).
 * Env: GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY (dán nguyên private_key trong file JSON, giữ "\n").
 * Chỉ ghi các cột B–F (DT, Tài khoản, Tiền mặt, CP trong két = Thu chi, Shopee = Shopee + Grab) và I (Ghi chú);
 * cột G (Chênh lệch), H (DT thực tế) giữ công thức sẵn có trong sheet.
 */

export const sheetsConfigured = () => !!process.env.GOOGLE_SA_EMAIL && !!process.env.GOOGLE_SA_PRIVATE_KEY;

function client() {
  if (!sheetsConfigured()) throw new Error("Chưa cấu hình service account Google (GOOGLE_SA_EMAIL / GOOGLE_SA_PRIVATE_KEY)");
  const jwt = new auth.JWT({
    email: process.env.GOOGLE_SA_EMAIL,
    key: process.env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheetsApi({ version: "v4", auth: jwt });
}

type SheetCfg = { revenueSheetId?: string | null; revenueTabPattern?: string | null; revenueFirstRow?: number | null };

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
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: cfg.revenueSheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        // template chưa có cột Grab → gộp vào cột Shopee (ghi rõ trong Ghi chú) để công thức Chênh lệch của sheet vẫn đúng
        { range: `${q}!B${row}:F${row}`, values: [[r.dt, r.tk, r.tm, r.cp, r.shopee + r.grab]] },
        { range: `${q}!I${row}`, values: [[note]] },
      ],
    },
  });
  return `${q}!B${row}:F${row}`;
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
