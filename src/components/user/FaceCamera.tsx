"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

type FaceApi = typeof import("@vladmandic/face-api");
let faceapiPromise: Promise<FaceApi> | null = null;

/** Tải face-api (chỉ phía trình duyệt) + model phát hiện khuôn mặt trong /public/models. */
function loadFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = (async () => {
      const faceapi = (await import("@vladmandic/face-api/dist/face-api.esm.js")) as unknown as FaceApi;
      await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready();
      await faceapi.nets.tinyFaceDetector.loadFromUri("/models");
      return faceapi;
    })();
  }
  return faceapiPromise;
}

export type FaceCapture = { photo: string };

/** Thời gian khuôn mặt phải ở yên trong khung (vòng xanh) trước khi tự chụp. */
const AUTO_DELAY_MS = 800;

/**
 * Camera chụp ảnh chấm công. KHÔNG có chức năng upload ảnh.
 * Chỉ cần phát hiện có khuôn mặt trong khung (vòng xanh) là chụp được – không so khớp với ảnh mẫu.
 */
export default function FaceCamera({
  onCapture,
  buttonLabel = "Chụp & xác nhận",
  disabled,
  autoCapture = true,
}: {
  onCapture: (c: FaceCapture) => void | Promise<void>;
  buttonLabel?: string;
  disabled?: boolean;
  /** Tự chụp khi khuôn mặt ở trong khung ~0,8 giây (vẫn có nút bấm tay). */
  autoCapture?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [faceOk, setFaceOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const lastFace = useRef(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const [faceapi, stream] = await Promise.all([
          loadFaceApi(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false }),
        ]);
        if (stop) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play();
        setStatus("ready");
        const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
        const loop = async () => {
          if (stop) return;
          try {
            const r = await faceapi.detectSingleFace(v, opts);
            const now = Date.now();
            if (r) lastFace.current = now;
            // giữ "có mặt" thêm 0,6s để vòng xanh / nút không nhấp nháy khi trượt 1 khung hình
            setFaceOk(now - lastFace.current < 600);
          } catch {}
          timer = setTimeout(loop, 60);
        };
        loop();
      } catch (e) {
        setStatus("error");
        setError(
          (e as Error).name === "NotAllowedError"
            ? "Bạn chưa cho phép truy cập camera. Hãy bật quyền camera cho trình duyệt rồi tải lại trang."
            : "Không mở được camera: " + (e as Error).message,
        );
      }
    })();
    return () => {
      stop = true;
      clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    setBusy(true);
    try {
      const faceapi = await loadFaceApi();
      const s = Math.min(v.videoWidth, v.videoHeight);
      const size = Math.min(640, s) || 480;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d")!.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, size, size);
      const r = await faceapi.detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }));
      if (!r) {
        setError("Không thấy khuôn mặt trong ảnh – hãy nhìn vào camera, đủ ánh sáng.");
        return;
      }
      setError("");
      await onCapture({ photo: c.toDataURL("image/jpeg", 0.8) });
    } finally {
      setBusy(false);
    }
  }, [onCapture]);

  // Tự chụp khi khuôn mặt ở trong khung liên tục AUTO_DELAY_MS; mất mặt thì huỷ, có mặt lại thì đếm lại
  const autoFired = useRef(false);
  useEffect(() => {
    if (!faceOk) autoFired.current = false;
    if (!autoCapture || autoFired.current || status !== "ready" || !faceOk || busy || disabled) return;
    const t = setTimeout(() => {
      autoFired.current = true;
      capture();
    }, AUTO_DELAY_MS);
    return () => clearTimeout(t);
  }, [autoCapture, status, faceOk, busy, disabled, capture]);

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-square w-full max-w-sm overflow-hidden rounded-3xl bg-ink/90 ring-4 ring-primary">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        <div
          className={`pointer-events-none absolute inset-8 rounded-[45%] border-4 border-dashed ${faceOk ? "border-secondary" : "border-white/60"}`}
        />
        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white">
            <Loader2 className="animate-spin" /> Đang mở camera…
          </div>
        )}
      </div>
      {status === "error" && <p className="text-center text-sm text-danger">{error}</p>}
      {status === "ready" && (
        <>
          <p className="text-center text-sm">
            {!faceOk
              ? "Đưa khuôn mặt vào khung"
              : busy || disabled
                ? "📸 Đang chụp…"
                : autoCapture
                  ? "✅ Giữ yên – app sẽ tự chụp"
                  : "✅ Sẵn sàng – bấm nút bên dưới"}
          </p>
          {error && <p className="text-center text-sm text-danger">{error}</p>}
          <Button className="w-full py-3 text-base" disabled={!faceOk || busy || disabled} onClick={capture}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />} {buttonLabel}
          </Button>
        </>
      )}
    </div>
  );
}
