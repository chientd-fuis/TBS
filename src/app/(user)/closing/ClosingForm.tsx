"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { Alert, Button, Card, Field, Textarea } from "@/components/ui";
import PhotoCamera from "@/components/user/PhotoCamera";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";

export default function ClosingForm({ shiftLabel, checkIn, employee }: { shiftLabel: string | null; checkIn?: string | null; employee?: string }) {
  const router = useRouter();
  const device = useDevice();
  const [photos, setPhotos] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "green" | "orange" | "red"; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setResult(null);
    let pos: GeolocationPosition | null = null;
    try {
      pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 8000 }));
    } catch {}
    const r = await fetch("/api/closing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photos, note, lat: pos?.coords.latitude, lng: pos?.coords.longitude }),
    });
    const j = await r.json().catch(() => ({ error: "Lỗi mạng" }));
    setBusy(false);
    if (!r.ok) return setResult({ tone: "red", text: j.error || "Chốt ca thất bại" });
    setResult({ tone: j.telegram === "SENT" ? "green" : "orange", text: j.message });
    setPhotos([]);
    setNote("");
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <DeviceNotice info={device} />
      {result && (
        <Alert tone={result.tone}>
          {result.tone === "green" && <CheckCircle2 size={16} className="mr-1 inline" />}
          {result.text}
        </Alert>
      )}
      <Card>
        <dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          <dt className="text-ink/60">Người chốt</dt><dd className="font-semibold">{employee}</dd>
          <dt className="text-ink/60">Ca</dt><dd className="font-semibold">{shiftLabel || "—"}</dd>
          <dt className="text-ink/60">Vào ca</dt><dd>{checkIn || "Chưa check-in"}</dd>
        </dl>
        <p className="mb-3 text-xs text-ink/70">Chụp ảnh chốt ca (tiền két, hoá đơn, sổ bàn giao…), tối đa 4 ảnh. Ảnh được gửi vào nhóm Telegram của quán.</p>
        <PhotoCamera photos={photos} onChange={setPhotos} />
      </Card>
      <Card>
        <Field label="Ghi chú (không bắt buộc)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="VD: Tiền mặt 2.350.000, chuyển khoản 1.200.000" />
        </Field>
        <Button className="mt-3 w-full py-3 text-base" variant="secondary" disabled={busy || !photos.length || device.state !== "APPROVED"} onClick={submit}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {busy ? "Đang gửi…" : "Chốt ca & gửi ảnh"}
        </Button>
      </Card>
    </div>
  );
}
