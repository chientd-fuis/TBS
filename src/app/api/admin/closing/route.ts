import { after, NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminActor, getAdmin } from "@/lib/admin-session";
import { connectDB } from "@/lib/db";
import { ShiftClosing, Store, User } from "@/lib/models";
import { deliverClosing } from "@/lib/closing";
import { afterClosing } from "@/lib/day-revenue";
import { CLOSING_SHIFTS } from "@/lib/revenue";
import { audit } from "@/lib/audit";
import { localDate } from "@/lib/time";
import { dataUrlToBuffer, HttpError, jsonError } from "@/lib/api";

export const preferredRegion = "sin1";
export const maxDuration = 60;

const Money = z.number().int().min(0).max(1_000_000_000);
const Raw = z.string().max(300);
const Body = z.object({
  storeId: z.string(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift: z.enum(["S", "C", "T"]),
  userId: z.string().optional(), // nhân viên chốt (không bắt buộc)
  photos: z.array(z.string().startsWith("data:image/")).max(4).default([]),
  sendTelegram: z.boolean().default(true),
  overwrite: z.boolean().default(false),
  note: z.string().max(500).optional(),
  revenue: z.object({
    dt: Money.nullable().optional(),
    tm: Money,
    tk: Money,
    cp: z.number().int().min(-1_000_000_000).max(1_000_000_000),
    grab: Money.default(0),
    shopee: Money.default(0),
  }),
  staffTotal: Money.nullable().optional(),
  revenueInput: z.object({ dt: Raw, tm: Raw, tk: Raw, cp: Raw, grab: Raw, shopee: Raw }).partial().optional(),
  ocr: z.object({ status: z.enum(["NONE", "OK", "FAILED"]), values: z.record(z.string(), z.number()).optional(), error: z.string().max(300).optional() }).optional(),
});

/** Admin nhập bù chốt ca còn thiếu (ảnh + số liệu). Ca đã có → chỉ ghi đè khi overwrite = true. */
export async function POST(req: Request) {
  try {
    const admin = await getAdmin();
    if (!admin) throw new HttpError(401, "Phiên admin đã hết hạn");
    const p = Body.safeParse(await req.json());
    if (!p.success) throw new HttpError(400, "Số liệu chốt ca chưa hợp lệ");
    const b = p.data;
    if (b.workDate > localDate(new Date())) throw new HttpError(400, "Không nhập chốt ca cho ngày tương lai");
    const ri = b.revenueInput;
    if (ri && (["tm", "tk"] as const).some((k) => !ri[k]?.trim())) throw new HttpError(400, "Nhập đủ Tiền mặt, Tài khoản");
    if (!ri?.dt?.trim()) b.revenue.dt = null;
    await connectDB();
    const store = await Store.findById(b.storeId).lean().catch(() => null);
    if (!store) throw new HttpError(400, "Chưa chọn cơ sở");
    const user = b.userId ? await User.findById(b.userId).select("name phone email").lean().catch(() => null) : null;
    const cs = CLOSING_SHIFTS.find((x) => x.key === b.shift)!;
    const prev = await ShiftClosing.findOne({ storeId: store._id, workDate: b.workDate, shiftName: cs.name }).select("_id employeeName").lean();
    if (prev && !b.overwrite) throw new HttpError(409, `Ca ${cs.name} ngày này đã có người chốt (${prev.employeeName || "?"}) – tick “Ghi đè” nếu muốn thay`, { code: "EXISTS" });
    const actor = adminActor(admin);
    const isDayEnd = b.shift === "T";
    const now = new Date();
    const saved = await ShiftClosing.findOneAndUpdate(
      { storeId: store._id, workDate: b.workDate, shiftName: cs.name },
      {
        $set: {
          ...(user ? { userId: user._id } : {}),
          shiftLabel: cs.name,
          employeeName: user?.name || user?.email || `Admin ${actor.name}`,
          employeePhone: user?.phone,
          addedByAdmin: actor.name,
          note: [b.note?.trim(), `Admin ${actor.name} nhập bù`].filter(Boolean).join(" · "),
          photos: [],
          revenue: b.revenue,
          revenueInput: b.revenueInput,
          staffTotal: b.staffTotal ?? null,
          ocr: b.ocr ?? { status: "NONE" },
          isDayEnd,
          telegram: { status: b.sendTelegram ? "PENDING" : "DISABLED", attempts: 0, ...(b.sendTelegram ? {} : { error: "Admin nhập bù – không gửi Telegram" }) },
          webhook: {},
          ...(prev ? { lastEditedAt: now } : {}),
        },
        $unset: { revenueEditedBy: 1, revenueEditedByOwner: 1, ...(user ? {} : { userId: 1 }) },
        ...(prev ? { $inc: { editCount: 1 } } : {}),
        $setOnInsert: { _id: new Types.ObjectId() },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();
    const id = String(saved!._id);
    const telegram = b.sendTelegram ? await deliverClosing(id, b.photos.map(dataUrlToBuffer)) : "DISABLED";
    const sheet = await afterClosing(store._id, b.workDate, isDayEnd).catch(() => "FAILED" as const);
    await audit(actor, prev ? "closing.admin.overwrite" : "closing.admin.create", { type: "ShiftClosing", id }, null, {
      storeId: String(store._id),
      workDate: b.workDate,
      shiftName: cs.name,
      ...(user ? { userId: String(user._id) } : {}),
      tm: b.revenue.tm,
      tk: b.revenue.tk,
    });
    if (isDayEnd && !prev)
      after(async () => {
        const { maybeSendDailyAfterClosing } = await import("@/lib/finance-report");
        await maybeSendDailyAfterClosing(b.workDate).catch(() => null);
      });
    revalidatePath("/admin/closings");
    revalidatePath("/admin/finance", "layout");
    return NextResponse.json({ ok: true, id, updated: !!prev, telegram, sheet });
  } catch (e) {
    return jsonError(e);
  }
}
