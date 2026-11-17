"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";
import PrivacySummary from "@/components/user/PrivacySummary";

export default function OnboardingForm({ stores, defaultName }: { stores: { id: string; name: string }[]; defaultName: string }) {
  const router = useRouter();
  const device = useDevice();
  const [form, setForm] = useState({ storeId: "", name: defaultName, phone: "", bankName: "", bankAccount: "", consent: false, consentBio: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const submit = async () => {
    if (!form.storeId || form.name.trim().length < 2 || form.phone.trim().length < 8)
      return setError("Vui lòng chọn cơ sở, nhập họ tên và số điện thoại.");
    if (!form.consent || !form.consentBio) return setError("Bạn cần tích đủ 2 ô đồng ý để gửi đăng ký.");
    setBusy(true);
    setError("");
    const r = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (!r.ok) return setError((await r.json()).error || "Đăng ký thất bại");
    router.replace("/pending");
  };

  return (
    <div className="space-y-4">
      <DeviceNotice info={device} />
      {error && <Alert tone="red">{error}</Alert>}
      <Card title="Thông tin đăng ký">
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
          </div>
        </Card>
      <PrivacySummary />
      <label className="flex items-start gap-2.5 rounded-2xl bg-card p-3 text-sm ring-1 ring-line">
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#3c9c54]" checked={form.consent} onChange={set("consent")} />
        <span>
          <b className="text-red-700">*</b> Tôi đã đọc và đồng ý với{" "}
          <a href="/privacy" target="_blank" className="font-bold underline">Chính sách quyền riêng tư</a>, cho phép Tiệm Bơ Sầu xử lý thông tin cá nhân của tôi để chấm công
          và trả lương.
        </span>
      </label>
      <label className={`flex items-start gap-2.5 rounded-2xl p-3 text-sm ring-1 ${form.consentBio ? "bg-card ring-line" : "bg-red-50/60 ring-red-300"}`}>
        <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#3c9c54]" checked={form.consentBio} onChange={set("consentBio")} />
        <span>
          <b className="text-red-700">*</b> Tôi đồng ý cho dùng <b>ảnh khuôn mặt</b> và <b>vị trí</b> khi chấm công, kể cả xử lý trên máy chủ ở nước ngoài.
          {!form.consentBio && <span className="mt-1 block text-xs text-red-700">Cần tích ô này – không có ảnh và vị trí thì không chấm công được.</span>}
        </span>
      </label>
      <Button className="w-full" disabled={busy || !form.consent || !form.consentBio} onClick={submit}>{busy ? "Đang gửi…" : "Gửi đăng ký"}</Button>
      <p className="text-center text-xs text-ink/60">Nút sáng lên khi đã tích đủ 2 ô.</p>
    </div>
  );
}
