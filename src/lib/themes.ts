/**
 * Màu giao diện app nhân viên (Tài khoản → Màu giao diện). Token màu từng theme ở app/globals.css (.theme-red, .theme-dark…).
 * File thuần (không import server) – dùng được cả ở component client (ô chọn màu).
 * Nhân viên thử việc luôn dùng màu tím thử việc (.theme-trial), không đổi được.
 */
/** nav = thanh menu trang admin (menu bên trái máy tính / thanh trên điện thoại) – globals.css --color-nav */
export const THEMES = [
  { id: "default", name: "Vàng bơ", header: "#fccc18", primary: "#fccc18", secondary: "#3c9c54", cream: "#fcf8ec", nav: "#18783c" },
  { id: "red", name: "Đỏ son", header: "#d62f36", primary: "#d62f36", secondary: "#7f1d22", cream: "#fff7f6", nav: "#64151a" },
  { id: "pink", name: "Hồng phấn", header: "#f7a9c9", primary: "#f7a9c9", secondary: "#c93a78", cream: "#fff6fa", nav: "#a52d62" },
  { id: "jade", name: "Ngọc bích", header: "#86d5b8", primary: "#86d5b8", secondary: "#0e8466", cream: "#f3fbf8", nav: "#0b6d54" },
  { id: "blue", name: "Xanh lam", header: "#b3d1ff", primary: "#b3d1ff", secondary: "#2563eb", cream: "#f6f9ff", nav: "#1d4ed8" },
  { id: "dark", name: "Tối", header: "#202024", primary: "#e4e4e7", secondary: "#5b5b63", cream: "#18181b", nav: "#202024" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];
export const THEME_IDS = THEMES.map((t) => t.id) as ThemeId[];
/** màu đầu trang khi thử việc (globals.css .theme-trial) */
const TRIAL_HEADER = "#e3b5f0";

/** id khung app (app/(user)/layout.tsx, app/manage/layout.tsx) – ô chọn màu đổi class theme ở đây ngay khi chạm */
export const THEME_ROOT_ID = "tbs-app";

export const isThemeId =(v: unknown): v is ThemeId => typeof v === "string" && (THEME_IDS as string[]).includes(v);

/** class đặt ở khung app: "" = Vàng bơ mặc định */
export const themeClass = (id: ThemeId | "trial") => (id === "default" ? "" : `theme-${id}`);

/** theme đang dùng của nhân viên: thử việc → "trial" */
export function themeOf(u: { probation?: boolean | null; theme?: string | null } | null | undefined): ThemeId | "trial" {
  if (u?.probation) return "trial";
  return isThemeId(u?.theme) ? u.theme : "default";
}

/** màu thanh trạng thái điện thoại (meta theme-color) = màu đầu trang */
export const themeHeaderColor = (id: ThemeId | "trial") => (id === "trial" ? TRIAL_HEADER : THEMES.find((t) => t.id === id)!.header);
