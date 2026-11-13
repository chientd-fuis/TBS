"use client";
import { SHEET_LAYOUTS } from "@/lib/revenue";
import { useState } from "react";
import { useSafeAction } from "@/components/useSafeAction";
import { Crosshair, MapPinned, Wifi } from "lucide-react";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { currentPublicIp, saveStore } from "../../actions/ops";

type S = { id: string; code: string; name: string; address: string; lat: number | null; lng: number | null; radiusM: number; timezone: string; telegramChatId: string; telegramGoodsChatId: string; telegramAttendanceChatId: string; revenueSheetId: string; revenueTabPattern: string; revenueFirstRow: number; revenueSheetLayout: string; active: boolean; checkFace: boolean; checkGps: boolean; checkWifi: boolean; wifiName: string; wifiIps: string[] };

export default function StoreForm({ store }: { store: S | null }) {
  // lỗi → giữ nguyên dữ liệu đã nhập; lưu xong không xoá form (đang sửa cơ sở)
  const { state, pending, formRef, onSubmit } = useSafeAction(saveStore, null, { resetOnOk: false });
  const [lat, setLat] = useState(store?.lat?.toString() ?? "");
  const [lng, setLng] = useState(store?.lng?.toString() ?? "");
  const [locErr, setLocErr] = useState("");
  const [gps, setGps] = useState(store?.checkGps ?? true);
  const [wifi, setWifi] = useState(store?.checkWifi ?? false);
  const [ips, setIps] = useState((store?.wifiIps ?? []).join("\n"));
  const [ipMsg, setIpMsg] = useState("");
  const addMyIp = async () => {
    setIpMsg("Đang lấy IP…");
    try {
      const r = await currentPublicIp();
      if (!r.ip) return setIpMsg("Không lấy được IP");
      const list = ips.split(/[\s,;]+/).filter(Boolean);
      if (!list.includes(r.ip)) setIps([...list, r.ip].join("\n"));
      setIpMsg(`IP mạng đang dùng: ${r.ip}${r.ip.includes(":") ? " (IPv6 – cả dải /64)" : ""}. Chỉ đúng khi máy này đang kết nối WiFi quán (tắt 4G). Nhớ bấm Lưu.`);
    } catch {
      setIpMsg("Không lấy được IP");
    }
  };
  const useHere = () =>
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setLocErr(`Sai số ±${Math.round(p.coords.accuracy)}m – nên đứng tại cửa hàng khi lấy toạ độ`);
      },
      () => setLocErr("Không lấy được vị trí"),
      { enableHighAccuracy: true },
    );
  const pasteFromMaps = (v: string) => {
    // dán "21.0123, 105.8123" hoặc link Google Maps có @lat,lng
    const m = v.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) {
      setLat(m[1]);
      setLng(m[2]);
    }
  };
  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="id" value={store?.id ?? ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Mã cơ sở"><Input name="code" defaultValue={store?.code ?? "TBS-"} required /></Field>
        <Field label="Tên cơ sở"><Input name="name" defaultValue={store?.name ?? "TBS "} required /></Field>
      </div>
      <Field label="Địa chỉ"><Input name="address" defaultValue={store?.address} /></Field>
      <Field label="Dán toạ độ / link Google Maps" hint="VD: 20.9876, 105.7890 – tự điền vĩ độ, kinh độ">
        <Input onChange={(e) => pasteFromMaps(e.target.value)} placeholder="Dán vào đây…" />
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Vĩ độ (lat)"><Input name="lat" value={lat} onChange={(e) => setLat(e.target.value)} /></Field>
        <Field label="Kinh độ (lng)"><Input name="lng" value={lng} onChange={(e) => setLng(e.target.value)} /></Field>
        <Field label="Bán kính (m)"><Input name="radiusM" type="number" min={20} defaultValue={store?.radiusM ?? 100} /></Field>
        <Field label="Múi giờ">
          <Select name="timezone" defaultValue={store?.timezone ?? "Asia/Ho_Chi_Minh"}>
            <option value="Asia/Ho_Chi_Minh">Việt Nam (UTC+7)</option>
            <option value="Asia/Tokyo">Nhật Bản (UTC+9)</option>
          </Select>
        </Field>
      </div>
      <fieldset className="space-y-2 rounded-xl bg-cream p-3">
        <legend className="px-1 text-sm font-semibold text-accent">Cách chấm công (bật nhiều cách → nhân viên phải qua tất cả)</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="checkFace" defaultChecked={store?.checkFace ?? true} className="accent-secondary" /> Chụp ảnh khuôn mặt
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="checkGps" checked={gps} onChange={(e) => setGps(e.target.checked)} className="accent-secondary" /> Vị trí (GPS trong bán kính)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="checkWifi" checked={wifi} onChange={(e) => setWifi(e.target.checked)} className="accent-secondary" /> WiFi của quán
          </label>
        </div>
        {!gps && !wifi && <p className="text-xs text-warn">Đang tắt cả vị trí và WiFi – nhân viên chấm công được ở bất kỳ đâu.</p>}
        {wifi && (
          <div className="space-y-2 border-t border-line pt-2">
            <p className="text-xs text-ink/70">
              Trình duyệt điện thoại không cho web đọc tên WiFi, nên app kiểm tra bằng <b>IP Internet của quán</b>: máy nhân viên phải đang dùng WiFi quán (không dùng
              4G / VPN / Chuyển tiếp bảo mật iCloud). Cách lấy IP: mở trang này <b>trên điện thoại đang kết nối WiFi quán</b> (tắt 4G) → bấm &quot;Lấy IP mạng đang dùng&quot;
              → Lưu. Nhà mạng có thể đổi IP khi modem khởi động lại – khi nhân viên báo lỗi WiFi thì lấy lại IP (hoặc đăng ký IP tĩnh với nhà mạng).
            </p>
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
              <Field label="Tên WiFi (hiện cho nhân viên)"><Input name="wifiName" defaultValue={store?.wifiName ?? ""} placeholder="VD TBS_Geleximco" /></Field>
              <Field label="IP WiFi quán" hint="Mỗi dòng 1 IP (IPv4, hoặc IPv6 – tự lấy cả dải /64). Quán có 2 mạng thì nhập cả 2.">
                <textarea name="wifiIps" rows={2} value={ips} onChange={(e) => setIps(e.target.value)} className="w-full rounded-xl border border-line bg-card px-3 py-2 font-mono text-sm" placeholder="113.190.xx.xx" />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => void addMyIp()}><Wifi size={16} /> Lấy IP mạng đang dùng</Button>
              {ipMsg && <span className="text-xs text-ink/70">{ipMsg}</span>}
            </div>
          </div>
        )}
        {!wifi && <input type="hidden" name="wifiIps" value={ips} />}
        {!wifi && <input type="hidden" name="wifiName" value={store?.wifiName ?? ""} />}
      </fieldset>
      <Field label="Telegram chat ID nhóm chốt ca" hint="VD: -1001234567890. Để trống = dùng nhóm mặc định (TELEGRAM_CHAT_ID). Bấm 'Lưu' rồi 'Gửi thử' để kiểm tra.">
        <Input name="telegramChatId" defaultValue={store?.telegramChatId ?? ""} placeholder="-100…" />
      </Field>
      <Field label="Telegram chat ID nhóm nhận hàng" hint="Nhận tin 📦 Nhận hàng / 📋 Tồn kho. Để trống = dùng TELEGRAM_GOODS_CHAT_ID; không có thì gửi vào nhóm chốt ca như trước.">
        <Input name="telegramGoodsChatId" defaultValue={store?.telegramGoodsChatId ?? ""} placeholder="-100…" />
      </Field>
      <Field label="Telegram chat ID nhóm chấm công" hint="Nhận thông báo check-in / check-out (ảnh, giờ vào/ra, đi muộn, về sớm). Để trống = dùng TELEGRAM_ATTENDANCE_CHAT_ID; không có thì không gửi.">
        <Input name="telegramAttendanceChatId" defaultValue={store?.telegramAttendanceChatId ?? ""} placeholder="-100…" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_6rem]">
        <Field label="Google Sheet doanh thu" hint="Dán link file sheet của cơ sở. Share file cho email service account (quyền Người chỉnh sửa).">
          <Input name="revenueSheetId" defaultValue={store?.revenueSheetId ? `https://docs.google.com/spreadsheets/d/${store.revenueSheetId}` : ""} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </Field>
        <Field label="Tên tab tháng" hint="{m} = số tháng">
          <Input name="revenueTabPattern" defaultValue={store?.revenueTabPattern || "T{m}"} />
        </Field>
        <Field label="Dòng ngày 1">
          <Input name="revenueFirstRow" type="number" min={1} defaultValue={store?.revenueFirstRow || 3} />
        </Field>
      </div>
      <Field label="Mẫu cột sheet" hint="Có cột Grab: B DT · C TK · D TM · E CP · F Shopee · G Grab · J Ghi chú. Mẫu cũ: Grab gộp vào F, ghi chú cột I.">
        <Select name="revenueSheetLayout" defaultValue={store?.revenueSheetLayout || "GRAB_COL"}>
          {SHEET_LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </Select>
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={useHere}><Crosshair size={16} /> Dùng vị trí hiện tại</Button>
        {lat && lng && (
          <a className="inline-flex items-center gap-1 text-sm text-accent underline" target="_blank" href={`https://www.google.com/maps?q=${lat},${lng}`}>
            <MapPinned size={16} /> Xem trên bản đồ
          </a>
        )}
        <label className="ml-auto flex items-center gap-1 text-sm">
          <input type="checkbox" name="active" defaultChecked={store?.active ?? true} className="accent-secondary" /> Đang hoạt động
        </label>
      </div>
      {locErr && <p className="text-xs text-ink/70">{locErr}</p>}
      {state?.error && <Alert tone="red">{state.error}</Alert>}
      {state?.ok && <Alert tone="green">Đã lưu</Alert>}
      <Button type="submit" disabled={pending}>{pending ? "Đang lưu…" : store ? "Lưu" : "Tạo cơ sở"}</Button>
    </form>
  );
}
