import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getServerSession } from "next-auth";
import { connectDB } from "./db";
import { AdminAccount, AdminLoginLog, User } from "./models";

export function isOwnerEmail(email?: string | null) {
  const owner = (process.env.OWNER_EMAIL || "").toLowerCase().trim();
  return !!email && !!owner && email.toLowerCase() === owner;
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
      // Chủ không phải nhân viên → không tạo User
      await connectDB();
      if (isOwnerEmail(user.email)) {
        await AdminLoginLog.create({ kind: "OWNER", displayName: user.email, success: true }).catch(() => {});
        return true;
      }
      // Gmail của admin (Chủ đã thêm) → không tự tạo hồ sơ nhân viên (nếu vừa là nhân viên thì vẫn cập nhật ảnh / tên)
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
