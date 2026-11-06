"use client";
import { useEffect, useState } from "react";

export type DeviceInfo =
  | { state: "loading" }
  | { state: "APPROVED" | "REVOKED" | "REJECTED" | "OTHER_USER" | "UNKNOWN"; deviceId?: string }
  | { state: "PENDING"; deviceId: string; reason: "NEW_DEVICE" | "FIRST_DEVICE"; requested?: boolean };

const LS_KEY = "tbs_device_id";

function getLocalId() {
  try {
    let id = localStorage.getItem(LS_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(LS_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

/** Fingerprint đơn giản của trình duyệt (SHA-256). */
export async function fingerprint() {
  const n = navigator as Navigator & { deviceMemory?: number };
  const parts = [
    n.userAgent,
    n.platform,
    n.language,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    String(window.devicePixelRatio),
    String(n.hardwareConcurrency ?? ""),
    String(n.deviceMemory ?? ""),
    String(n.maxTouchPoints ?? ""),
  ];
  try {
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "top";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#f60";
      ctx.fillRect(10, 1, 62, 20);
      ctx.fillStyle = "#069";
      ctx.fillText("Tiệm Bơ Sầu 🥑", 2, 15);
      parts.push(c.toDataURL());
    }
  } catch {}
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Đăng ký / kiểm tra thiết bị với server mỗi lần mở app (spec 4.1.1). */
export function useDevice() {
  const [info, setInfo] = useState<DeviceInfo>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const fp = await fingerprint();
        const r = await fetch("/api/device/hello", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ localId: getLocalId(), fingerprint: fp }),
        });
        const j = await r.json();
        if (j.deviceId) {
          try {
            localStorage.setItem(LS_KEY, j.deviceId);
          } catch {}
        }
        if (alive) setInfo(j);
      } catch {
        if (alive) setInfo({ state: "UNKNOWN" });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return info;
}
