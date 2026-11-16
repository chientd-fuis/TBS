"use client";
import { useCallback, useEffect, useState } from "react";
import type { CheckinLock } from "@/lib/auto-checkout";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, LogOut, MapPin, TriangleAlert, Wifi } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import { cn, minutesVi } from "@/lib/format";
import FaceCamera, { type FaceCapture } from "./FaceCamera";
import { DeviceNotice } from "./DeviceNotice";
import { fingerprint, useDevice } from "./useDevice";
import type { CheckMethods } from "@/lib/checkin-methods";

type Result = {
  action: "CHECK_IN" | "CHECK_OUT";
  time: string;
  lateMinutes?: number;
  earlyMinutes?: number;
  totalHours?: number;
  roundedHours?: number;
  shiftLabel?: string | null;
  outOfShift?: boolean;
  storeName?: string;
  support?: boolean;
  /** làm ngoài giờ (ra muộn / vào sớm / ngoài ca) → chờ admin xác nhận */
  overtimeNote?: string | null;
  /** bấm check-out sau giờ chốt ca tối: giờ chốt ("23:00") + giờ bấm thật */
  cappedAt?: string | null;
  pressedAt?: string | null;
};

/** "Nguyễn Thu Nga" → "TN" (2 chữ cuối), "Đức" → "Đ" */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }),
  );
}

export default function CheckInWidget({
  openSince,
  storeName,
  supportNote,
  methods = { face: true, faceDetect: true, gps: true, wifi: false },
  wifiNames = [],
  lock = null,
  capNote,
  shift = null,
  openAtMs = null,
  dateLabel,
  coworkers = [],
}: {
  /** ca hôm nay đang / sắp làm → hiện giờ ca + đếm ngược tới giờ vào */
  shift?: { name: string; start: string; end: string; startMs: number } | null;
  /** giờ check-in của lượt đang mở (ms) → đếm "đã làm" */
  openAtMs?: number | null;
  /** "T2 17/11" */
  dateLabel?: string;
  /** người cùng ca (cùng cơ sở, giờ ca giao nhau) – inAt: giờ đã check-in "07:52" */
  coworkers?: { name: string; inAt?: string | null }[];
  openSince: string | null;
  storeName: string;
  supportNote?: string;
  /** đang trong ca mà đã quá giờ chốt ca tối → nhắc check-out (công chỉ tính tới giờ chốt) */
  capNote?: string;
  /** cách xác thực cơ sở bật: chụp mặt / vị trí / WiFi */
  methods?: CheckMethods;
  wifiNames?: string[];
  /** khoá chấm công (vừa được tự check-out 2 tiếng / giờ cấm check-in) – lib/auto-checkout.ts */
  lock?: CheckinLock | null;
}) {
  const router = useRouter();
  const device = useDevice();
  const [step, setStep] = useState<"idle" | "locating" | "camera" | "sending">("idle");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState("");
  // tone "warn" = thành công nhưng có lưu ý (ngoài ca, đi muộn…) – nền vàng, vẫn dấu tích, lưu ý ghi dòng dưới
  const [toasts, setToasts] = useState<{ id: number; tone: "ok" | "warn"; text: string; notes?: string[] }[]>([]);
  const toast = useCallback((tone: "ok" | "warn", text: string, notes: string[] = []) => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l, { id, tone, text, notes }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), tone === "ok" ? 4000 : 8000);
  }, []);
  // sau khi chấm xong, cập nhật ngay trạng thái (không chờ trang tải lại)
  const [localOpen, setLocalOpen] = useState<string | null | undefined>(undefined);
  const openNow = localOpen !== undefined ? localOpen : openSince;
  // khoá chỉ áp dụng khi không có lượt đang mở; tới giờ hết khoá → tải lại trạng thái (VD 01:00 đổi sang “cấm check-in”, 06:00 mở)
  const locked = !openNow ? lock : null;
  useEffect(() => {
    if (!locked) return;
    const ms = new Date(locked.until).getTime() - Date.now() + 1500;
    const t = window.setTimeout(() => router.refresh(), Math.min(Math.max(ms, 1000), 2_000_000_000));
    return () => window.clearTimeout(t);
  }, [locked, router]);
  const isCheckOut = locked ? locked.button === "CHECK-OUT" : !!openNow;
  // đồng hồ: "đã làm 4h 12′" / "còn 12 phút tới giờ vào ca" – cập nhật mỗi 30 giây
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const [localOpenAt, setLocalOpenAt] = useState<number | null | undefined>(undefined);
  const openAt = localOpenAt !== undefined ? localOpenAt : openAtMs;
  const workedMin = openNow && openAt ? Math.max(0, Math.floor((now - openAt) / 60_000)) : 0;
  const toStart = shift ? Math.ceil((shift.startMs - now) / 60_000) : null;

  const start = async () => {
    setError("");
    let p: GeolocationPosition | null = null;
    try {
      if (methods.gps) {
        setStep("locating");
        p = await getPosition();
      }
      setPos(p);
      if (methods.face) setStep("camera");
      else void submit(null, p); // không cần chụp mặt → gửi luôn
    } catch (e) {
      const ge = e as GeolocationPositionError;
      setError(
        ge.code === 1
          ? "Bạn chưa cho phép truy cập vị trí. Hãy bật quyền vị trí cho trình duyệt rồi thử lại."
          : "Không lấy được vị trí – hãy bật GPS và thử lại.",
      );
      setStep("idle");
    }
  };

  const submit = useCallback(
    async (c: FaceCapture | null, at: GeolocationPosition | null = pos) => {
      if (methods.gps && !at) return;
      setStep("sending");
      setError("");
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(at ? { lat: at.coords.latitude, lng: at.coords.longitude, accuracy: at.coords.accuracy } : {}),
          ...(c ? { photo: c.photo } : {}),
          fingerprint: await fingerprint().catch(() => undefined),
        }),
      }).catch(() => null);
      const j = r ? await r.json().catch(() => ({})) : { error: "Mất kết nối mạng – thử lại" };
      if (!r || !r.ok) {
        setError(j.error || "Chấm công thất bại");
        setStep(j.code === "FACE_MISMATCH" && methods.face ? "camera" : "idle");
        return;
      }
      const res = j as Result;
      const where = res.storeName ? ` · ${res.storeName}${res.support ? " (hỗ trợ)" : ""}` : "";
      // 1 thông báo duy nhất: "thành công" + lưu ý (nếu có) ngay bên dưới – không hiện thêm ô cảnh báo riêng như báo lỗi
      const notes = [
        res.action === "CHECK_IN" && res.outOfShift ? "Bạn không có ca được xếp vào giờ này – giờ làm sẽ được gửi quản lý xác nhận. Nhớ CHECK-OUT khi về." : "",
        res.action === "CHECK_IN" && res.lateMinutes ? `Đi muộn ${minutesVi(res.lateMinutes)}.` : "",
        res.cappedAt ? `Quá giờ chốt ca tối – chỉ tính công tới ${res.cappedAt}.` : "",
        res.earlyMinutes ? `Về sớm ${minutesVi(res.earlyMinutes)}.` : "",
        res.overtimeNote ?? "",
      ].filter(Boolean);
      toast(
        notes.length ? "warn" : "ok",
        res.action === "CHECK_IN"
          ? `Check-in thành công lúc ${res.time}${where}${res.shiftLabel ? ` · Ca ${res.shiftLabel}` : ""}`
          : `Check-out thành công lúc ${res.pressedAt ?? res.time}${where} · ${res.roundedHours ?? 0}h tính công`,
        notes,
      );
      setLocalOpen(res.action === "CHECK_IN" ? res.time : null);
      setLocalOpenAt(res.action === "CHECK_IN" ? Date.now() : null);
      setStep("idle"); // quay về màn chính → thấy ngay nút CHECK-OUT sau khi check-in
      router.refresh();
    },
    [pos, router, toast, methods.gps, methods.face],
  );

  const deviceOk = device.state === "APPROVED";

  return (
    <div className="space-y-3">
      <DeviceNotice info={device} />
      {error && (
        <Alert tone="red">
          <TriangleAlert size={16} className="mr-1 inline" />
          {error}
        </Alert>
      )}

      {/* Thông báo nổi trên đầu màn hình, tự ẩn – chạm để đóng */}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <button
              key={t.id}
              onClick={() => setToasts((l) => l.filter((x) => x.id !== t.id))}
              className={cn(
                "pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-2xl px-4 py-3 text-left text-sm shadow-lg ring-1 animate-[tbs-toast_.25s_ease-out]",
                t.tone === "ok" ? "bg-secondary text-white ring-secondary-dark" : "bg-primary-light text-ink ring-primary",
              )}
            >
              <CheckCircle2 size={18} className={cn("mt-0.5 shrink-0", t.tone === "warn" && "text-good")} />
              <span className="min-w-0">
                <span className={cn("block", t.tone === "warn" && "font-semibold")}>{t.text}</span>
                {t.notes?.map((n) => (
                  <span key={n} className="mt-1 flex items-start gap-1 text-[13px] text-late-fg">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                    {n}
                  </span>
                ))}
              </span>
            </button>
          ))}
        </div>
      )}

      {methods.face && (step === "camera" || step === "sending") ? (
        <Card>
          {pos && (
            <p className="mb-2 flex items-center gap-1 text-xs text-ink/70">
              <MapPin size={14} /> Đã lấy vị trí (sai số ±{Math.round(pos.coords.accuracy || 0)}m)
            </p>
          )}
          <FaceCamera
            onCapture={submit}
            detect={methods.faceDetect}
            autoCapture={false}
            disabled={step === "sending"}
            buttonLabel={step === "sending" ? "Đang ghi nhận…" : isCheckOut ? "Chụp & Check-out" : "Chụp & Check-in"}
          />
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep("idle")}>Huỷ</Button>
        </Card>
      ) : (
        <section className="flex flex-col items-center gap-3.5 rounded-3xl bg-card p-4 text-center shadow-[0_6px_18px_rgba(122,74,20,.08)] ring-1 ring-line">
          {/* trạng thái + ngày */}
          <div className="flex w-full items-center justify-between gap-2">
            {isCheckOut && !locked ? (
              <span className="flex animate-pulse items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-1 text-xs font-bold text-good motion-reduce:animate-none">
                <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden /> Đang trong ca
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-ink/70">Chưa check-in</span>
            )}
            <span className="truncate text-xs font-semibold text-ink/60">
              {storeName}
              {dateLabel ? ` · ${dateLabel}` : ""}
            </span>
          </div>
          {supportNote && <Alert tone="blue">⇄ {supportNote}</Alert>}
          {capNote && openNow && <Alert tone="yellow">⏰ {capNote}</Alert>}
          {locked ? (
            <Alert tone={locked.kind === "auto" ? "blue" : "yellow"}>
              {locked.kind === "auto" ? "🤖 " : "🌙 "}
              {locked.message}
            </Alert>
          ) : isCheckOut ? (
            <div>
              <p className="text-[13px] text-ink/70">Vào lúc {openNow?.slice(0, 5)} · đã làm</p>
              <p className="text-4xl font-extrabold tracking-tight text-accent tabular-nums">
                {Math.floor(workedMin / 60)}h {String(workedMin % 60).padStart(2, "0")}′
              </p>
            </div>
          ) : shift ? (
            <div>
              <p className="text-[13px] text-ink/70">Ca hôm nay</p>
              <p className="text-2xl font-extrabold tracking-tight text-accent">
                {shift.name} · {shift.start} – {shift.end}
              </p>
              {toStart != null && toStart > 0 ? (
                <p className="mt-0.5 text-[13px] font-semibold text-warn">Còn {minutesVi(toStart)} tới giờ vào ca</p>
              ) : toStart != null && toStart < 0 ? (
                <p className="mt-0.5 text-[13px] font-semibold text-danger">Đã quá giờ vào ca {minutesVi(-toStart)}</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink/70">Hôm nay bạn không có ca được xếp</p>
          )}

          {isCheckOut ? (
            <button
              type="button"
              disabled={!deviceOk || !!locked || step === "locating" || step === "sending"}
              aria-disabled={!!locked || undefined}
              title={locked?.message}
              onClick={start}
              className="flex h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-accent text-[19px] font-extrabold tracking-wide text-on-accent shadow-[0_8px_18px_rgba(123,52,52,.28)] disabled:opacity-50"
            >
              {step === "locating" || step === "sending" ? <Loader2 className="animate-spin" /> : <LogOut />}
              {step === "locating" ? "Đang lấy vị trí…" : step === "sending" ? "Đang ghi nhận…" : "CHECK-OUT"}
            </button>
          ) : (
            <span className="relative my-3 inline-flex">
              {/* viền vàng nhạt quanh nút */}
              <span className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_10px_var(--color-primary-light)]" aria-hidden />
            <button
              type="button"
              disabled={!deviceOk || !!locked || step === "locating" || step === "sending"}
              aria-disabled={!!locked || undefined}
              title={locked?.message}
              onClick={start}
              className="relative flex h-40 w-40 flex-col items-center justify-center gap-1 rounded-full border border-primary-dark bg-primary text-on-primary shadow-[0_10px_24px_rgba(0,0,0,.15)] active:scale-[.98] disabled:opacity-50"
            >
              {step === "locating" || step === "sending" ? <Loader2 size={30} className="animate-spin" /> : <LogIn size={30} />}
              <span className="text-xl font-extrabold tracking-wide">{step === "locating" ? "Đang lấy vị trí…" : step === "sending" ? "Đang ghi…" : "CHECK-IN"}</span>
              {step === "idle" && <span className="text-[11px] font-medium opacity-80">{methods.face ? "Chụp mặt & ghi nhận" : "Bấm để ghi nhận"}</span>}
            </button>
            </span>
          )}

          {/* người cùng ca – chỉ hiện trước khi check-in */}
          {coworkers.length > 0 && !isCheckOut && (
            <div className="flex w-full items-center gap-2.5 rounded-2xl bg-cream px-3 py-2.5 text-left">
              <span className="flex shrink-0">
                {coworkers.slice(0, 3).map((c, i) => (
                  <span
                    key={c.name + i}
                    className={cn("grid h-8 w-8 place-items-center rounded-full border-2 border-card text-[11px] font-bold", i % 3 === 0 ? "bg-rose-bg" : i % 3 === 1 ? "bg-info-bg" : "bg-ok-bg", i > 0 && "-ml-2")}
                    aria-hidden
                  >
                    {initials(c.name)}
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1 text-[13px]">
                <b>Cùng ca:</b> {coworkers.map((c) => c.name).join(", ")}
                {coworkers.some((c) => c.inAt) && (
                  <span className="font-semibold text-good">
                    {" "}
                    · {coworkers.filter((c) => c.inAt).map((c) => `${c.name.split(" ").pop()} đã vào ${c.inAt}`).join(", ")}
                  </span>
                )}
              </span>
            </div>
          )}
          {methods.wifi && wifiNames.length > 0 && !isCheckOut && (
            <p className="flex items-center justify-center gap-1 text-xs text-ink/60">
              <Wifi size={13} /> Bắt WiFi quán ({wifiNames.join(" / ")}) trước khi chấm
            </p>
          )}
          {device.state === "loading" && <p className="text-xs text-ink/60">Đang kiểm tra thiết bị…</p>}
        </section>
      )}
    </div>
  );
}
