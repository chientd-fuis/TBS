"use client";
import { useEffect, useRef } from "react";

/** Cuộn ngang bảng tháng tới cột hôm nay (đặt bên trong khung cuộn). */
export default function ScrollToToday() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const box = ref.current?.closest("[data-month-board]") as HTMLElement | null;
    const th = box?.querySelector("[data-today]") as HTMLElement | null;
    if (box && th) box.scrollLeft = Math.max(0, th.offsetLeft - 100);
  }, []);
  return <span ref={ref} hidden />;
}
