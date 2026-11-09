import { NextResponse } from "next/server";
import { adminActor, getAdmin } from "@/lib/admin-session";
import { can } from "@/lib/permissions";
import { connectDB } from "@/lib/db";
import { buildExport, EXPORT_TYPES, type ExportType } from "@/lib/export";
import { audit } from "@/lib/audit";

export const maxDuration = 60;

/** GET /api/admin/export?type=chamcong&store=<id>&store=<id>&from=2026-11&to=2026-11&user=<id> */
export async function GET(req: Request) {
  const admin = await getAdmin();
  if (!admin) return new NextResponse("Unauthorized", { status: 401 });
  if (!can(admin, "export")) return new NextResponse("Bạn chưa được Chủ cấp quyền Xuất Excel", { status: 403 });
  await connectDB();
  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") as ExportType;
  if (!type || !(type in EXPORT_TYPES)) return new NextResponse("Loại báo cáo không hợp lệ", { status: 400 });
  if (type === "tonghopthang" && admin.kind !== "OWNER") return new NextResponse("Chỉ chủ được xuất báo cáo tài chính", { status: 403 });
  const from = sp.get("from") || "";
  const to = sp.get("to") || from;
  if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to) || to < from) return new NextResponse("Khoảng tháng không hợp lệ", { status: 400 });
  const filter = {
    type,
    storeIds: sp.getAll("store").filter(Boolean),
    userIds: sp.getAll("user").filter(Boolean),
    fromMonth: from,
    toMonth: to,
    exportedBy: adminActor(admin).name,
  };
  let built;
  try {
    built = await buildExport(filter);
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 400 });
  }
  const { buffer, fileName } = built;
  // File chứa STK, lương → ghi audit log mỗi lần xuất
  await audit(adminActor(admin), "export.excel", { type: "Export", id: type }, null, filter);
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "cache-control": "no-store",
    },
  });
}
