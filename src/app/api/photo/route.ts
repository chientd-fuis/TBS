import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-session";
import { getCurrentUser } from "@/lib/guards";
import { Attendance, FaceProfile, ShiftClosing } from "@/lib/models";
import { readPhoto } from "@/lib/drive";
import { connectDB } from "@/lib/db";

/** Xem ảnh chấm công: admin xem tất cả, nhân viên chỉ xem ảnh của mình. ?att=<id>&dir=in|out  hoặc ?face=<userId> */
export async function GET(req: Request) {
  await connectDB();
  const url = new URL(req.url);
  const admin = await getAdmin();
  const user = admin ? null : await getCurrentUser();
  if (!admin && !user) return new NextResponse("Unauthorized", { status: 401 });

  let driveId: string | undefined;
  let pendingId: string | undefined;
  const att = url.searchParams.get("att");
  const face = url.searchParams.get("face");
  if (att) {
    const a = await Attendance.findById(att).lean();
    if (!a) return new NextResponse("Not found", { status: 404 });
    if (!admin && String(a.userId) !== String(user!._id)) return new NextResponse("Forbidden", { status: 403 });
    const out = url.searchParams.get("dir") === "out";
    driveId = (out ? a.checkOutPhotoId : a.checkInPhotoId) || undefined;
    pendingId = (out ? a.checkOutPendingPhotoId : a.checkInPendingPhotoId)?.toString();
  } else if (url.searchParams.get("closing")) {
    const c = await ShiftClosing.findById(url.searchParams.get("closing")).lean();
    if (!c) return new NextResponse("Not found", { status: 404 });
    if (!admin && String(c.userId) !== String(user!._id)) return new NextResponse("Forbidden", { status: 403 });
    const ph = c.photos[Number(url.searchParams.get("i") || 0)];
    driveId = ph?.driveId || undefined;
    pendingId = ph?.pendingId?.toString();
  } else if (face) {
    if (!admin) return new NextResponse("Forbidden", { status: 403 });
    const f = await FaceProfile.findOne({ userId: face }).lean();
    driveId = f?.imageDriveId || undefined;
    pendingId = f?.pendingPhotoId?.toString();
  }
  try {
    const buf = await readPhoto({ driveId, pendingId });
    if (!buf) return new NextResponse("Không có ảnh", { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
    });
  } catch (e) {
    return new NextResponse("Không đọc được ảnh: " + (e as Error).message, { status: 502 });
  }
}
