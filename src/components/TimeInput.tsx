"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Chuẩn hoá giờ 24h: "8" → 08:00, "830" → 08:30, "1745" → 17:45, "8:5" → 08:05,
 * có giây: "083015" → 08:30:15. Trả về null nếu không hợp lệ, "" nếu bỏ trống.
 */
export function normalizeTime(raw: string, seconds = false): string | null {
  const v = raw.trim();
  if (!v) return "";
  let h: number, m = 0, s = 0;
  if (v.includes(":") || v.includes(".") || v.includes("h")) {
    const p = v.split(/[:.h]/).map((x) => x.trim());
    if (p.some((x) => x !== "" && !/^\d{1,2}$/.test(x))) return null;
    [h, m = 0, s = 0] = p.map((x) => (x === "" ? 0 : Number(x)));
  } else {
    if (!/^\d{1,6}$/.test(v)) return null;
    const d = v.length === 3 || v.length === 5 ? "0" + v : v; // 830 → 0830, 83015 → 083015
    h = Number(d.slice(0, 2));
    m = Number(d.slice(2, 4) || 0);
    s = Number(d.slice(4, 6) || 0);
  }
  if (h > 23 || m > 59 || s > 59) return null;
  return seconds && s ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
}

/**
 * Ô nhập giờ dạng 24h (không có SA/CH như <input type="time"> theo ngôn ngữ máy).
 * Gõ "0830" hoặc "8:30" → tự thành 08:30 khi rời ô. Giá trị gửi lên form: "HH:mm" (hoặc "HH:mm:ss").
 */
export default function TimeInput({
  defaultValue,
  seconds = false,
  onBlur,
  name,
  ...p
}: Omit<ComponentProps<"input">, "type" | "defaultValue" | "value"> & { defaultValue?: string; seconds?: boolean }) {
  const init = defaultValue ? (normalizeTime(String(defaultValue), seconds) ?? String(defaultValue)) : "";
  const [value, setValue] = useState(init);
  const ref = useRef<HTMLInputElement>(null);

  // form.reset() (VD sau khi lưu thành công) → về giá trị ban đầu
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setValue(init);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [init]);

  const check = (v: string) => {
    const n = normalizeTime(v, seconds);
    ref.current?.setCustomValidity(n === null ? "Giờ không hợp lệ – nhập dạng 24h, VD 08:30 hoặc 17:45" : "");
    return n;
  };

  // gửi lên form giá trị đã chuẩn hoá (kể cả khi bấm Enter mà chưa rời ô)
  const submitted = normalizeTime(value, seconds) ?? value;
  return (
    <>
    <input type="hidden" name={name} value={submitted} />
    <Input
      {...p}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder={p.placeholder ?? "VD 08:30"}
      maxLength={8}
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d:.h]/g, "");
        setValue(v);
        check(v);
      }}
      onBlur={(e) => {
        const n = check(value);
        if (n !== null) setValue(n);
        onBlur?.(e);
      }}
    />
    </>
  );
}
