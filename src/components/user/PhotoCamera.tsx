"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Camera chụp ảnh tài liệu / quầy (mặc định camera SAU). Không có chức năng chọn ảnh từ thư viện.
 * Chụp nhiều ảnh (tối đa `max`), mỗi ảnh nén JPEG cạnh dài ≤ 1600px.
 */
export default function PhotoCamera({
  photos,
  onChange,
  max = 4,
  shootLabel,
}: {
  photos: string[];
  onChange: (p: string[]) => void;
  max?: number;
  shootLabel?: string; // VD "Chụp & gửi"
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    let stop = false;
    setStatus("loading");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        videoRef.current!.srcObject = stream;
        await videoRef.current!.play();
        setStatus("ready");
      } catch (e) {
        setStatus("error");
        setError((e as Error).name === "NotAllowedError" ? "Bạn chưa cho phép dùng camera. Bật quyền camera rồi tải lại trang." : "Không mở được camera: " + (e as Error).message);
      }
    })();
    return () => {
      stop = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    onChange([...photos, c.toDataURL("image/jpeg", 0.82)]);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-2xl bg-shade ring-4 ring-primary">
        <video ref={videoRef} playsInline muted className={`aspect-[3/4] w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`} />
        {flash && <div className="absolute inset-0 bg-white/80" />}
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-white"><Loader2 className="animate-spin" /> Đang mở camera…</div>
        )}
        <button
          type="button"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
          className="absolute top-2 right-2 rounded-full bg-black/50 p-2 text-white"
          aria-label="Đổi camera"
        >
          <RefreshCw size={18} />
        </button>
      </div>
      {status === "error" && <p className="text-center text-sm text-danger">{error}</p>}
      <Button type="button" className="w-full py-3 text-base" disabled={status !== "ready" || photos.length >= max} onClick={shoot}>
        <Camera size={18} /> {shootLabel ?? (photos.length >= max ? `Đã đủ ${max} ảnh` : `Chụp ảnh (${photos.length}/${max})`)}
      </Button>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {photos.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`Ảnh ${i + 1}`} className="aspect-square w-full rounded-lg object-cover ring-1 ring-line" />
              <button
                type="button"
                onClick={() => onChange(photos.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-danger p-0.5 text-white"
                aria-label="Xoá ảnh"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
