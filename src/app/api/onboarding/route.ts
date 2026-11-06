import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guards";
import { Store, User } from "@/lib/models";
import { encrypt } from "@/lib/crypto";
import { HttpError, jsonError } from "@/lib/api";
import { audit } from "@/lib/audit";

const Body = z.object({
  storeId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(8).max(20),
  bankName: z.string().trim().max(60).default(""),
  bankAccount: z.string().trim().max(30).default(""),
  consent: z.literal(true),
});

/** Đăng ký vào cửa hàng lần đầu (spec 4.1). */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new HttpError(401, "Chưa đăng nhập");
    if (!["NEW", "REJECTED"].includes(user.status)) throw new HttpError(400, "Tài khoản đã đăng ký");
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) throw new HttpError(400, "Thông tin chưa hợp lệ – kiểm tra lại các trường bắt buộc");
    const b = parsed.data;
    const store = await Store.findOne({ _id: b.storeId, active: true }).lean();
    if (!store) throw new HttpError(400, "Cơ sở không tồn tại");

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          storeId: store._id,
          name: b.name,
          phone: b.phone,
          bankName: b.bankName,
          bankAccountEnc: encrypt(b.bankAccount),
          status: "PENDING",
          registeredAt: new Date(),
          consentFaceAt: new Date(),
        },
        $unset: { rejectReason: 1 },
      },
    );
    await audit({ kind: "USER", name: user.email }, "user.register", { type: "User", id: String(user._id) }, null, {
      storeId: String(store._id),
      name: b.name,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
