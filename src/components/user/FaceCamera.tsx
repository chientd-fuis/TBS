"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";

type FaceApi = typeof import("@vladmandic/face-api");
let faceapiPromise: Promise<FaceApi> | null = null;

/** Tải face-api (chỉ phía trình duyệt) + model trong /public/models. */
function loadFaceApi() {
  if (!faceapiPromise) {
    faceapiPromise = (async () => {
      const faceapi = (await import("@vladmandic/face-api/dist/face-api.esm.js")) as unknown as FaceApi;
      await (faceapi.tf as unknown as { ready: () => Promise<void> }).ready();
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return faceapi;
    })();
  }
  return faceapiPromise;
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/** Eye Aspect Ratio – dùng phát hiện chớp mắt (liveness cơ bản). */
function ear(eye: Pt[]) {
  return (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / (2 * dist(eye[0], eye[3]));
}

export type FaceCapture = { descriptor: number[]; photo: string };

/**
 * Camera chụp khuôn mặt. KHÔNG có chức năng upload ảnh (spec 4.2).
 * - requireBlink: yêu cầu chớp mắt trước khi chụp (chống dùng ảnh in / màn hình).
 */
export default function FaceCamera({
  onCapture,
  requireBlink = true,
  buttonLabel = "Chụp & xác nhận",
  disabled,
}: {
  onCapture: (c: FaceCapture) => void | Promise<void>;
  requireBlink?: boolean;
  buttonLabel?: string;
  disabled?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [faceOk, setFaceOk] = useState(false);
  const [blinked, setBlinked] = useState(!requireBlink);
  const [busy, setBusy] = useState(false);
  const eyeClosed = useRef(false);

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
            const r = await faceapi.detectSingleFace(v, opts).withFaceLandmarks();
            setFaceOk(!!r);
            if (r && requireBlink) {
              const e = (ear(r.landmarks.getLeftEye()) + ear(r.landmarks.getRightEye())) / 2;
              if (e < 0.21) eyeClosed.current = true;
              else if (eyeClosed.current && e > 0.25) {
                setBlinked(true);
                eyeClosed.current = false;
              }
            }
          } catch {}
          timer = setTimeout(loop, 120);
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
  }, [requireBlink]);

  const capture = useCallback(async () => {
    const v = videoRef.current;
    if (!v) return;
    setBusy(true);
    try {
      const faceapi = await loadFaceApi();
      const size = Math.min(640, v.videoWidth, v.videoHeight) || 480;
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      const ctx = c.getContext("2d")!;
      const sx = (v.videoWidth - Math.min(v.videoWidth, v.videoHeight)) / 2;
      const sy = (v.videoHeight - Math.min(v.videoWidth, v.videoHeight)) / 2;
      const s = Math.min(v.videoWidth, v.videoHeight);
      ctx.drawImage(v, sx, sy, s, s, 0, 0, size, size);
      const r = await faceapi
        .detectSingleFace(c, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      if (!r) {
        setError("Không thấy khuôn mặt rõ ràng – hãy nhìn thẳng vào camera, đủ ánh sáng.");
        return;
      }
      setError("");
      const photo = c.toDataURL("image/jpeg", 0.8);
      await onCapture({ descriptor: Array.from(r.descriptor), photo });
    } finally {
      setBusy(false);
    }
  }, [onCapture]);

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
              : !blinked
                ? "👁️ Hãy chớp mắt một lần để xác nhận người thật"
                : "✅ Sẵn sàng – bấm nút bên dưới"}
          </p>
          {error && <p className="text-center text-sm text-danger">{error}</p>}
          <Button className="w-full py-3 text-base" disabled={!faceOk || !blinked || busy || disabled} onClick={capture}>
            {busy ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />} {buttonLabel}
          </Button>
        </>
      )}
    </div>
  );
}
