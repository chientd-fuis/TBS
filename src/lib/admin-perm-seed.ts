import { connectDB } from "./db";
import { AdminAccount } from "./models";
import { DEFAULT_ON_PERMS } from "./permissions";

/**
 * Quyền mặc định bật (DEFAULT_ON_PERMS): thêm 1 LẦN cho mọi tài khoản admin chưa được thêm quyền đó
 * (đánh dấu ở permsSeeded) → Admin Tổng tắt sau thì không bị bật lại. Chạy 1 lần / tiến trình máy chủ.
 */
let done: Promise<void> | null = null;

export function seedDefaultPerms() {
  done ??= (async () => {
    await connectDB();
    for (const k of DEFAULT_ON_PERMS)
      await AdminAccount.updateMany({ permsSeeded: { $ne: k } }, { $addToSet: { perms: k, permsSeeded: k } });
  })().catch((e) => {
    done = null; // lỗi → lần sau thử lại
    console.error("[seedDefaultPerms]", (e as Error).message);
  });
  return done;
}
