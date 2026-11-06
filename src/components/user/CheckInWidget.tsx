"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, LogIn, LogOut, MapPin, TriangleAlert } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import FaceCamera, { type FaceCapture } from "./FaceCamera";
import { DeviceNotice } from "./DeviceNotice";
import { fingerprint, useDevice } from "./useDevice";

type Result = {
  action: "CHECK_IN" | "CHECK_OUT";
  time: string;
  lateMinutes?: number;
  earlyMinutes?: number;
  totalHours?: number;
  roundedHours?: number;
  shiftLabel?: string | null;
  outOfShift?: boolean;
};

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }),
  );
}

export default function CheckInWidget({ openSince, storeName }: { openSince: string | null; storeName: string }) {
  const router = useRouter();
  const device = useDevice();
  const [step, setStep] = useState<"idle" | "locating" | "camera" | "sending" | "done">("idle");
  const [pos, setPos] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const isCheckOut = !!openSince;

  const start = async () => {
    setError("");
    setStep("locating");
    try {
      const p = await getPosition();
      setPos(p);
      setStep("camera");
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
    async (c: FaceCapture) => {
      if (!pos) return;
      setStep("sending");
      setError("");
      const r = await fetch("/api/attendance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          photo: c.photo,
          fingerprint: await fingerprint().catch(() => undefined),
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setError(j.error || "Chấm công thất bại");
        setStep(j.code === "FACE_MISMATCH" ? "camera" : "idle");
        return;
      }
      setResult(j);
      setStep("done");
      router.refresh();
    },
    [pos, router],
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

      {step === "done" && result ? (
        <Card>
          <div className="space-y-2 text-center">
            <CheckCircle2 className="mx-auto text-secondary" size={48} />
            <p className="text-lg font-bold">
              {result.action === "CHECK_IN" ? "Check-in" : "Check-out"} thành công lúc {result.time}
            </p>
            {result.shiftLabel && <p className="text-sm">Ca: {result.shiftLabel}</p>}
            {result.outOfShift && result.action === "CHECK_IN" && <Alert tone="gray">Bạn không có ca được xếp – đã ghi nhận "Ngoài ca".</Alert>}
            {!!result.lateMinutes && result.action === "CHECK_IN" && <Alert tone="orange">⚠️ Đi muộn {result.lateMinutes} phút</Alert>}
            {!!result.earlyMinutes && <Alert tone="orange">⚠️ Về sớm {result.earlyMinutes} phút</Alert>}
            {result.action === "CHECK_OUT" && (
              <p className="text-sm">
                Tổng: <b>{result.totalHours}h</b> · Giờ tính công: <b>{result.roundedHours}h</b>
              </p>
            )}
            <Button variant="outline" onClick={() => { setStep("idle"); setResult(null); }}>Xong</Button>
          </div>
        </Card>
      ) : step === "camera" || step === "sending" ? (
        <Card>
          <p className="mb-2 flex items-center gap-1 text-xs text-ink/70">
            <MapPin size={14} /> Đã lấy vị trí (sai số ±{Math.round(pos?.coords.accuracy || 0)}m)
          </p>
          <FaceCamera
            onCapture={submit}
            disabled={step === "sending"}
            buttonLabel={step === "sending" ? "Đang ghi nhận…" : isCheckOut ? "Chụp & Check-out" : "Chụp & Check-in"}
          />
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep("idle")}>Huỷ</Button>
        </Card>
      ) : (
        <Card>
          <div className="space-y-3 text-center">
            <p className="text-sm text-ink/70">{storeName}</p>
            {isCheckOut ? (
              <p>Bạn đang trong ca từ <b>{openSince}</b></p>
            ) : (
              <p>Bạn chưa check-in</p>
            )}
            <Button
              variant={isCheckOut ? "secondary" : "primary"}
              className="h-20 w-full rounded-2xl text-xl"
              disabled={!deviceOk || step === "locating"}
              onClick={start}
            >
              {step === "locating" ? <Loader2 className="animate-spin" /> : isCheckOut ? <LogOut /> : <LogIn />}
              {step === "locating" ? "Đang lấy vị trí…" : isCheckOut ? "CHECK-OUT" : "CHECK-IN"}
            </Button>
            {device.state === "loading" && <p className="text-xs text-ink/60">Đang kiểm tra thiết bị…</p>}
          </div>
        </Card>
      )}
    </div>
  );
}
