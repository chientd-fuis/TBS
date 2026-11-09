import { NextResponse } from "next/server";
import { getAdmin } from "@/lib/admin-session";
import { connectDB } from "@/lib/db";
import { Store, User } from "@/lib/models";
import { HttpError, jsonError } from "@/lib/api";
import { buildAttendanceTemplate, readAttendanceWorkbook } from "@/lib/attendance-import-xlsx";
import { localMonth } from "@/lib/time";

export const maxDuration = 60;
const MAX_BYTES = 8 * 1024 * 1024;

/** Tải file mẫu: ?store=<id>&month=YYYY-MM – mỗi nhân viên đang làm 1 sheet. */
export async function GET(req: Request) {
  try {
    if (!(await getAdmin())) throw new HttpError(401, "Phiên admin đã hết hạn");
    const u = new URL(req.url);
    const month = /^\d{4}-\d{2}$/.test(u.searchParams.get("month") ?? "") ? u.searchParams.get("month")! : localMonth(new Date());
    await connectDB();
    const store = await Store.findById(u.searchParams.get("store")).lean().catch(() => null);
    if (!store) throw new HttpError(404, "Không tìm thấy cơ sở");
    const staff = await User.find({ storeId: store._id, status: "ACTIVE" }).sort({ name: 1 }).select("name").lean();
    const buf = await buildAttendanceTemplate(staff.length ? staff.map((s) => s.name || "Nhân viên") : ["Tên nhân viên"], month, store.name);
    const fileName = `MauChamCong_T${month.slice(5)}_${store.name.replace(/\s+/g, "")}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}

/** Đọc file Excel chấm công (multipart: file) → các sheet + lượt làm việc. Chưa ghi gì vào database. */
export async function POST(req: Request) {
  try {
    if (!(await getAdmin())) throw new HttpError(401, "Phiên admin đã hết hạn");
    const fd = await req.formData();
    const f = fd.get("file");
    if (!(f instanceof File)) throw new HttpError(400, "Chưa chọn file");
    if (f.size > MAX_BYTES) throw new HttpError(400, "File quá lớn (tối đa 8 MB)");
    if (!/\.xlsx$/i.test(f.name)) throw new HttpError(400, "Chỉ nhận file .xlsx (file .xls cũ: mở bằng Excel rồi Lưu thành .xlsx)");
    const ds = String(fd.get("dayStart") ?? "");
    const sheets = await readAttendanceWorkbook(await f.arrayBuffer(), { dayStart: /^\d{2}:\d{2}$/.test(ds) ? ds : "08:00" }).catch(() => {
      throw new HttpError(400, "Không đọc được file – kiểm tra lại định dạng .xlsx");
    });
    if (!sheets.length) throw new HttpError(400, "Không thấy sheet nào đúng mẫu (cần hàng tiêu đề có cột “Ngày” và “Thời gian”)");
    return NextResponse.json({ ok: true, sheets });
  } catch (e) {
    return jsonError(e);
  }
}
