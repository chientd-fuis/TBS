export type FormState = { ok?: boolean; error?: string } | null;

export function num(v: FormDataEntryValue | null, def = 0) {
  const n = Number(String(v ?? "").replace(/[.,\s₫]/g, ""));
  return Number.isFinite(n) ? n : def;
}
/** Số thập phân (chấp nhận "0,5" hoặc "0.5") – KHÔNG dùng num() vì num() bỏ dấu chấm/phẩy. */
export function dec(v: FormDataEntryValue | null, def = 0) {
  const n = Number(String(v ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? n : def;
}
export function str(v: FormDataEntryValue | null) {
  return String(v ?? "").trim();
}
export function errMsg(e: unknown): FormState {
  const err = e as { digest?: string; message?: string };
  if (err?.digest?.startsWith("NEXT_REDIRECT")) throw e;
  return { error: err?.message || "Lỗi hệ thống" };
}
