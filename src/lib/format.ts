export function vnd(n: number | null | undefined) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n ?? 0)) + " ₫";
}
export function hoursVi(n: number | null | undefined) {
  if (n == null) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
/** Số phút cảnh báo (muộn / về sớm / làm thêm…): dưới 60 → "45'", từ 60 → "1h", "1h30'", "2h05'" */
export function minutesVi(m: number | null | undefined) {
  const v = Math.max(0, Math.round(m ?? 0));
  if (v < 60) return `${v}'`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}'` : `${h}h`;
}
export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
