export function vnd(n: number | null | undefined) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n ?? 0)) + " ₫";
}
export function hoursVi(n: number | null | undefined) {
  if (n == null) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(n);
}
export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}
