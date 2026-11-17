"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptPrivacy } from "@/app/(user)/actions";

/**
 * Popup "Cập nhật quyền riêng tư": hiện khi có Chính sách mới (hoặc lần đầu phát hành) mà nhân viên chưa đồng ý.
 * "Để sau" ẩn tạm – vẫn xem lịch, bảng lương được nhưng chấm công bị chặn (API trả lỗi PRIVACY) cho đến khi đồng ý.
 */
export default function PrivacyConsentModal({ version, renewed }: { version: number; renewed: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl bg-red-50 px-4 py-3 text-left text-sm text-red-800 ring-1 ring-red-200"
      >
        🔒 Bạn chưa đồng ý Chính sách quyền riêng tư (v{version}) – <b>chưa chấm công được</b>. Bấm để đồng ý →
      </button>
    );

  const ok = () =>
    start(async () => {
      setErr("");
      const r = await acceptPrivacy(version);
      if (r.error) return setErr(r.error);
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="max-h-[90vh] w-full max-w-sm space-y-2.5 overflow-y-auto rounded-3xl bg-card p-4 shadow-2xl">
        <div className="text-center text-3xl">🔒</div>
        <p className="text-center text-base font-extrabold text-accent">{renewed ? "Chính sách quyền riêng tư đã cập nhật" : "Cập nhật quyền riêng tư"}</p>
        <p className="text-center text-sm text-ink/70">
          {renewed ? `Quán vừa phát hành phiên bản ${version}.` : "App đã có Chính sách quyền riêng tư."} Vui lòng đọc và đồng ý để tiếp tục chấm công.
        </p>
        <p className="rounded-xl bg-cream px-3 py-2 text-xs leading-relaxed text-ink/70">📷 Ảnh khuôn mặt · 📍 Vị trí lúc bấm · 📱 Thiết bị · 👤 Họ tên, SĐT · 💳 STK (mã hoá)</p>
        <a href="/privacy" target="_blank" className="block text-center text-sm font-bold text-accent underline">
          Đọc Chính sách quyền riêng tư →
        </a>
        <label className="flex items-start gap-2.5 rounded-xl p-2.5 text-[13px] ring-1 ring-line">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#3c9c54]" checked={a} onChange={(e) => setA(e.target.checked)} />
          <span>Tôi đã đọc và đồng ý với Chính sách quyền riêng tư.</span>
        </label>
        <label className="flex items-start gap-2.5 rounded-xl p-2.5 text-[13px] ring-1 ring-line">
          <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#3c9c54]" checked={b} onChange={(e) => setB(e.target.checked)} />
          <span>
            Tôi đồng ý cho dùng <b>ảnh khuôn mặt</b> và <b>vị trí</b> khi chấm công (kể cả xử lý trên máy chủ ở nước ngoài).
          </span>
        </label>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <button
          type="button"
          disabled={!a || !b || pending}
          onClick={ok}
          className="w-full rounded-2xl bg-[#3a9a50] py-3 text-[15px] font-bold text-white disabled:opacity-40"
        >
          {pending ? "Đang lưu…" : "Đồng ý & tiếp tục"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="w-full text-center text-xs text-ink/60 underline">
          Để sau – chưa chấm công được, vẫn xem lịch, bảng lương
        </button>
      </div>
    </div>
  );
}
