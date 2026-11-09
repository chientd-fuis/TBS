/*
 * Cách xác thực khi chấm công – cài đặt theo từng cơ sở:
 *  - face: chụp ảnh khuôn mặt (mặc định BẬT)
 *  - gps:  vị trí trong bán kính quán (mặc định BẬT)
 *  - wifi: phải dùng WiFi của quán (mặc định TẮT)
 * Bật nhiều cách → phải qua TẤT CẢ.
 *
 * WiFi: trình duyệt (Safari / Chrome trên điện thoại) KHÔNG cho web đọc tên WiFi (SSID/BSSID) – chỉ app native mới đọc được.
 * → Kiểm tra bằng IP Internet (IP public) của quán: mọi máy dùng WiFi quán ra Internet cùng 1 IP của modem.
 *   Máy dùng 4G / WiFi khác / VPN / iCloud Private Relay sẽ có IP khác → bị từ chối.
 *   IPv6: mỗi mạng nhà có 1 dải /64 cố định → so 4 nhóm đầu.
 */
export type CheckMethods = { face: boolean; gps: boolean; wifi: boolean };

export function methodsOf(s: { checkFace?: boolean | null; checkGps?: boolean | null; checkWifi?: boolean | null } | null | undefined): CheckMethods {
  return { face: s?.checkFace !== false, gps: s?.checkGps !== false, wifi: s?.checkWifi === true };
}

/** Gộp yêu cầu của nhiều cơ sở có thể chấm (cơ sở gốc + cơ sở hỗ trợ) → client chuẩn bị đủ dữ liệu. */
export const anyMethods = (list: CheckMethods[]): CheckMethods => ({
  face: list.some((m) => m.face),
  gps: list.some((m) => m.gps),
  wifi: list.some((m) => m.wifi),
});

/** Chuẩn hoá IP để so khớp: IPv4 giữ nguyên, IPv6 lấy dải /64 ("2001:db8:1:2::/64"). */
export function normalizeIp(raw: string): string {
  let ip = (raw || "").trim().toLowerCase();
  if (!ip) return "";
  if (ip.startsWith("::ffff:") && ip.includes(".")) ip = ip.slice(7); // IPv4 dạng IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip;
  if (ip.endsWith("/64")) ip = ip.slice(0, -3);
  if (!ip.includes(":")) return ip;
  // mở rộng "::" rồi lấy 4 nhóm đầu
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${full
    .slice(0, 4)
    .map((x) => x.replace(/^0+(?=.)/, "") || "0")
    .join(":")}::/64`;
}

/** Danh sách IP admin nhập (mỗi dòng / dấu phẩy 1 IP) → chuẩn hoá, bỏ trùng. */
export function parseIpList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((x) => x.replace(/#.*$/, "").trim())
        .filter(Boolean)
        .map(normalizeIp)
        .filter(isValidNormalizedIp),
    ),
  ];
}

export const isValidNormalizedIp = (ip: string) =>
  /^(\d{1,3})(\.\d{1,3}){3}$/.test(ip) ? ip.split(".").every((n) => Number(n) <= 255) : /^([0-9a-f]{1,4}:){4}:\/64$/.test(ip);

export function ipAllowed(ip: string, list: string[] | null | undefined) {
  const n = normalizeIp(ip);
  return !!n && (list ?? []).some((x) => normalizeIp(x) === n);
}
