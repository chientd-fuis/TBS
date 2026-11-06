"use client";
import { DeviceNotice } from "@/components/user/DeviceNotice";
import { useDevice } from "@/components/user/useDevice";

export default function PendingDevice() {
  const info = useDevice();
  return <DeviceNotice info={info} />;
}
