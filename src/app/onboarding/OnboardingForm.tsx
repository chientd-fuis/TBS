"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import FaceCamera, { type FaceCapture } from "@/components/user/FaceCamera";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";

export default function OnboardingForm({ stores, defaultName }: { stores: { id: string; name: string }[]; defaultName: string }) {
  const router = useRouter();
  const device = useDevice();
  const [form, setForm] = useState({ storeId: "", name: defaultName, phone: "", bankName: "", bankAccount: "", consent: false });
  const [face, setFace] = useState<FaceCapture | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const next = () => {
    if (!form.storeId || form.name.trim().length < 2 || form.phone.trim().length < 8)
      return setError("Vui lòng chọn cơ sở, nhập họ tên và số điện thoại.");
    if (!form.consent) return setError("Bạn cần đồng ý cho phép thu thập ảnh khuôn mặt để chấm công.");
    setError("");
    setStep(2);
  };

  const submit = async () => {
    if (!face) return;
    setBusy(true);
    setError("");
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, descriptor: face.descriptor, photo: face.photo }),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json()).error || "Đăng ký thất bại");
    router.replace("/pending");
  };

  return (
    <div className="space-y-4">
      <DeviceNotice info={device} />
      {error && <Alert tone="red">{error}</Alert>}
      {step === 1 ? (
        <Card title="1. Thông tin cơ bản">
          <div className="space-y-3">
            <Field label="Cơ sở làm việc *">
              <Select value={form.storeId} onChange={set("storeId")}>
                <option value="">— Chọn cơ sở —</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Họ tên *"><Input value={form.name} onChange={set("name")} /></Field>
            <Field label="Số điện thoại *"><Input inputMode="tel" value={form.phone} onChange={set("phone")} /></Field>
            <Field label="Ngân hàng"><Input placeholder="VD: Vietcombank" value={form.bankName} onChange={set("bankName")} /></Field>
            <Field label="Số tài khoản"><Input inputMode="numeric" value={form.bankAccount} onChange={set("bankAccount")} /></Field>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={form.consent} onChange={set("consent")} />
              <span>Tôi đồng ý cho Tiệm Bơ Sầu thu thập và lưu trữ ảnh khuôn mặt, vị trí và thông tin thiết bị của tôi để phục vụ chấm công.</span>
            </label>
            <Button className="w-full" onClick={next}>Tiếp tục</Button>
          </div>
        </Card>
      ) : (
        <Card title="2. Chụp ảnh khuôn mặt mẫu">
          {face ? (
            <div className="space-y-3 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={face.photo} alt="Ảnh mẫu" className="mx-auto w-48 -scale-x-100 rounded-2xl" />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setFace(null)}>Chụp lại</Button>
                <Button className="flex-1" disabled={busy} onClick={submit}>{busy ? "Đang gửi…" : "Gửi đăng ký"}</Button>
              </div>
            </div>
          ) : (
            <FaceCamera onCapture={setFace} buttonLabel="Chụp ảnh mẫu" />
          )}
          <Button variant="ghost" className="mt-2 w-full" onClick={() => setStep(1)}>Quay lại</Button>
        </Card>
      )}
    </div>
  );
}
