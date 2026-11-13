export function vnd(n: number | null | undefined) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n ?? 0)) + " ₫";
}
export function hoursVi(n: number | null | undefined) {
  if (n == null) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
/** Số phút cảnh báo (đi muộn / về sớm / làm thêm…): dưới 60 → "45'", từ 60 → "1H", "1H 30'", "2H 05'" */
export function minutesVi(m: number | null | undefined) {
  const v = Math.max(0, Math.round(m ?? 0));
  if (v < 60) return `${v}'`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h}H ${String(r).padStart(2, "0")}'` : `${h}H`;
}
export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
