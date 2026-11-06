"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";

export default function OnboardingForm({ stores, defaultName }: { stores: { id: string; name: string }[]; defaultName: string }) {
  const router = useRouter();
  const device = useDevice();
  const [form, setForm] = useState({ storeId: "", name: defaultName, phone: "", bankName: "", bankAccount: "", consent: false });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });

  const submit = async () => {
    if (!form.storeId || form.name.trim().length < 2 || form.phone.trim().length < 8)
      return setError("Vui lòng chọn cơ sở, nhập họ tên và số điện thoại.");
    if (!form.consent) return setError("Bạn cần đồng ý để tiếp tục.");
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
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-[#3c9c54]" checked={form.consent} onChange={set("consent")} />
              <span>Tôi đồng ý cho Tiệm Bơ Sầu lưu ảnh chụp khi chấm công, vị trí và thông tin thiết bị của tôi để phục vụ chấm công.</span>
            </label>
            <Button className="w-full" disabled={busy} onClick={submit}>{busy ? "Đang gửi…" : "Gửi đăng ký"}</Button>
          </div>
        </Card>
    </div>
  );
}
