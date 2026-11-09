"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, LogOut, MapPin, TriangleAlert, Wifi } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import { cn } from "@/lib/format";
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
};

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }),
  );
}

export default function CheckInWidget({
  openSince,
  storeName,
  supportNote,
  methods = { face: true, gps: true, wifi: false },
  wifiNames = [],
}: {
  openSince: string | null;
  storeName: string;
  supportNote?: string;
  /** cách xác thực cơ sở bật: chụp mặt / vị trí / WiFi */
  methods?: CheckMethods;
  wifiNames?: string[];
}) {
  const router = useRouter();
  const device = useDevice();
  const [step, setStep] = useState<"idle" | "locating" | "camera" | "sending">("idle");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<{ id: number; tone: "ok" | "warn"; text: string }[]>([]);
  const toast = useCallback((tone: "ok" | "warn", text: string) => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l, { id, tone, text }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), tone === "ok" ? 4000 : 7000);
  }, []);
  // sau khi chấm xong, cập nhật ngay trạng thái (không chờ trang tải lại)
  const [localOpen, setLocalOpen] = useState<string | null | undefined>(undefined);
  const openNow = localOpen !== undefined ? localOpen : openSince;
  const isCheckOut = !!openNow;

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
      toast(
        "ok",
        res.action === "CHECK_IN"
          ? `Check-in thành công lúc ${res.time}${where}${res.shiftLabel ? ` · Ca ${res.shiftLabel}` : ""}`
          : `Check-out thành công lúc ${res.time}${where} · ${res.roundedHours ?? 0}h tính công`,
      );
      if (res.action === "CHECK_IN" && res.outOfShift) toast("warn", "Bạn đang chấm công ngoài ca (không có ca được xếp) – giờ làm vẫn được ghi nhận, nhớ CHECK-OUT khi về.");
      if (res.action === "CHECK_IN" && res.lateMinutes) toast("warn", `Đi muộn ${res.lateMinutes} phút`);
      if (res.earlyMinutes) toast("warn", `Về sớm ${res.earlyMinutes} phút`);
      setLocalOpen(res.action === "CHECK_IN" ? res.time : null);
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
                t.tone === "ok" ? "bg-secondary text-white ring-secondary-dark" : "bg-[#fff4e5] text-warn ring-warn/40",
              )}
            >
              {t.tone === "ok" ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <TriangleAlert size={18} className="mt-0.5 shrink-0" />}
              <span>{t.text}</span>
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
            autoCapture={false}
            disabled={step === "sending"}
            buttonLabel={step === "sending" ? "Đang ghi nhận…" : isCheckOut ? "Chụp & Check-out" : "Chụp & Check-in"}
          />
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep("idle")}>Huỷ</Button>
        </Card>
      ) : (
        <Card>
          <div className="space-y-3 text-center">
            <p className="text-sm text-ink/70">{storeName}</p>
            {supportNote && <Alert tone="blue">⇄ {supportNote}</Alert>}
            {isCheckOut ? (
              <p>Bạn đang trong ca từ <b>{openNow}</b></p>
            ) : (
              <p>Bạn chưa check-in</p>
            )}
            <Button
              variant={isCheckOut ? "secondary" : "primary"}
              className="h-20 w-full rounded-2xl text-xl"
              disabled={!deviceOk || step === "locating" || step === "sending"}
              onClick={start}
            >
              {step === "locating" || step === "sending" ? <Loader2 className="animate-spin" /> : isCheckOut ? <LogOut /> : <LogIn />}
              {step === "locating" ? "Đang lấy vị trí…" : step === "sending" ? "Đang ghi nhận…" : isCheckOut ? "CHECK-OUT" : "CHECK-IN"}
            </Button>
            {methods.wifi && (
              <p className="flex items-center justify-center gap-1 text-xs text-ink/70">
                <Wifi size={14} /> Kết nối WiFi của quán{wifiNames.length ? ` (${wifiNames.join(" / ")})` : ""} trước khi chấm công
              </p>
            )}
            {device.state === "loading" && <p className="text-xs text-ink/60">Đang kiểm tra thiết bị…</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
