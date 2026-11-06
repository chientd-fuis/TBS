import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/guards";
import { DEVICE_COOKIE } from "@/lib/device";
import { Device } from "@/lib/models";
import { jsonError } from "@/lib/api";

/** Nhân viên bấm "Yêu cầu đổi thiết bị" → admin thấy trong mục Thiết bị chờ duyệt. */
export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Chưa đăng nhập" }, { status: 401 });
    const deviceId = (await cookies()).get(DEVICE_COOKIE)?.value;
    const r = await Device.updateOne({ deviceId, userId: user._id, status: { $in: ["PENDING", "REJECTED"] } }, { $set: { requestedAt: new Date(), status: "PENDING" } });
    if (!r.matchedCount) return NextResponse.json({ error: "Không có thiết bị cần duyệt" }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
