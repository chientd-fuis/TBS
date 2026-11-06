"use client";
import { useState } from "react";
import { Smartphone } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import type { DeviceInfo } from "./useDevice";

export function DeviceNotice({ info }: { info: DeviceInfo }) {
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  if (info.state === "loading" || info.state === "APPROVED") return null;
  if (info.state === "UNKNOWN")
    return <Alert tone="red">Không kiểm tra được thiết bị (mất mạng hoặc trình duyệt chặn cookie). Hãy tải lại trang.</Alert>;
  if (info.state === "OTHER_USER")
    return (
      <Alert tone="red">
        <b>Thiết bị này đã gắn với nhân viên khác.</b> Bạn không thể chấm công trên máy này – hãy dùng điện thoại của chính bạn.
      </Alert>
    );
  if (info.state === "PENDING" && info.reason === "FIRST_DEVICE")
    return <Alert tone="yellow">Thiết bị này sẽ được duyệt cùng lúc admin duyệt tài khoản của bạn.</Alert>;
  const request = async () => {
    setErr("");
    const r = await fetch("/api/device/request", { method: "POST" });
    if (r.ok) setSent(true);
    else setErr((await r.json()).error || "Lỗi");
  };
  return (
    <Alert tone="orange">
      <div className="flex items-start gap-2">
        <Smartphone size={18} className="mt-0.5 shrink-0" />
        <div className="space-y-2">
          <p>
            {info.state === "PENDING"
              ? "Đây là thiết bị mới (hoặc dữ liệu trình duyệt đã bị xoá). Bạn vẫn xem được dữ liệu nhưng chưa thể chấm công cho đến khi admin duyệt thiết bị."
              : "Thiết bị này đã bị thu hồi / từ chối quyền chấm công."}
          </p>
          {sent || (info.state === "PENDING" && info.requested) ? (
            <p className="font-semibold">Đã gửi yêu cầu đổi thiết bị – chờ admin duyệt.</p>
          ) : (
            <Button variant="outline" onClick={request}>
              Yêu cầu đổi thiết bị
            </Button>
          )}
          {err && <p className="text-danger">{err}</p>}
        </div>
      </div>
    </Alert>
  );
}
