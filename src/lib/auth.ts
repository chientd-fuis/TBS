import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getServerSession } from "next-auth";
import { connectDB } from "./db";
import { AdminAccount, AdminLoginLog, Settings, User } from "./models";

export function isOwnerEmail(email?: string | null) {
  const owner = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
  return !!email && !!owner && email.toLowerCase() === owner;
}

/** Gmail là admin (Admin Tổng / admin đang hoạt động) → đăng nhập xong luôn vào trang quản lý. */
export async function isAdminEmail(email?: string | null) {
  if (!email) return false;
  if (isOwnerEmail(email)) return true;
  await connectDB();
  return !!(await AdminAccount.exists({ email: email.toLowerCase(), status: "ACTIVE" }));
}

/**
 * Gmail admin có bị chặn khỏi app nhân viên không (kể cả khi có hồ sơ nhân viên adminStaff để có dòng bảng lương).
 *  - Admin: tick riêng từng tài khoản ở Quản lý admin (AdminAccount.userApp); tài khoản cũ chưa đặt → theo Settings.adminUserApp.
 *  - Admin Tổng: Cài đặt → "Cho phép chính Admin Tổng vào app nhân viên" (Settings.ownerUserApp).
 * Nhân viên cần quản lý dùng role quản lý ở app User.
 */
export async function userAppBlocked(email?: string | null) {
  if (!email) return false;
  await connectDB();
  if (isOwnerEmail(email)) {
    const s = await Settings.findOne({ key: "main" }).select("ownerUserApp").lean();
    return s?.ownerUserApp !== true;
  }
  const acc = await AdminAccount.findOne({ email: email.toLowerCase(), status: "ACTIVE" }).select("userApp").lean();
  if (!acc) return false; // không phải admin đang hoạt động → nhân viên bình thường
  if (typeof acc.userApp === "boolean") return !acc.userApp;
  const s = await Settings.findOne({ key: "main" }).select("adminUserApp").lean();
  return s?.adminUserApp !== true;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
  ],
  session: { strategy: "jwt", maxAge: 30 * 24 * 3600 },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      // Admin Tổng không phải nhân viên → không tạo User
      await connectDB();
      if (isOwnerEmail(user.email)) {
        await AdminLoginLog.create({ kind: "OWNER", displayName: user.email, success: true }).catch(() => {});
        return true;
      }
      // Gmail của admin (Admin Tổng đã thêm) → không tự tạo hồ sơ nhân viên (nếu vừa là nhân viên thì vẫn cập nhật ảnh / tên)
      const isAdmin = !!(await AdminAccount.exists({ email: user.email.toLowerCase() }));
      await User.updateOne(
        { email: user.email.toLowerCase() },
        {
          $set: { googleName: user.name, avatar: user.image },
          $setOnInsert: { email: user.email.toLowerCase(), status: "NEW" },
        },
        { upsert: !isAdmin },
      );
      return true;
    },
  },
};

export async function getSessionEmail() {
  const s = await getServerSession(authOptions);
  return s?.user?.email?.toLowerCase() ?? null;
}
