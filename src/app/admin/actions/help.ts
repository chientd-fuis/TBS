"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Settings } from "@/lib/models";
import { assertOwner } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { docxToText } from "@/lib/docx-text";
import { isPosition, normalizeHelp, POSITIONS, type FaqItem, type HelpSectionKey } from "@/lib/help";

type Res = { ok?: boolean; error?: string };

/** Lưu 1 mục Help (Admin Tổng). workflow: payload = { BEP: "...", ... }; faq: payload = [{q,a}]; còn lại: chuỗi. */
export async function saveHelpSection(section: HelpSectionKey, payload: unknown, guideFile?: string): Promise<Res> {
  try {
    const admin = await assertOwner();
    await connectDB();
    let set: Record<string, unknown>;
    if (section === "workflow") {
      const p = (payload ?? {}) as Record<string, unknown>;
      set = Object.fromEntries(POSITIONS.filter((x) => isPosition(x.key)).map((x) => [`help.workflow.${x.key}`, String(p[x.key] ?? "").slice(0, 50_000)]));
    } else if (section === "faq") {
      const list = normalizeHelp({ faq: Array.isArray(payload) ? (payload as FaqItem[]) : [] }).faq;
      if (list.some((x) => !x.q || !x.a)) return { error: "Mỗi tình huống cần cả câu hỏi và câu trả lời" };
      set = { "help.faq": list };
    } else if (section === "guide" || section === "about") {
      set = { [`help.${section}`]: String(payload ?? "").slice(0, 50_000) };
      if (section === "guide" && guideFile !== undefined) set["help.guideFile"] = guideFile.slice(0, 200);
    } else return { error: "Mục không hợp lệ" };
    await Settings.updateOne({ key: "main" }, { $set: set }, { upsert: true });
    await audit(adminActor(admin), "settings.help", { type: "Settings", id: section }, null, { section });
    revalidatePath("/help", "layout");
    revalidatePath("/admin/settings/help");
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message || "Không lưu được" };
  }
}

/** Đọc file Word (.docx) → chữ để admin xem trước / sửa rồi mới lưu. */
export async function importHelpDocx(fd: FormData): Promise<{ text?: string; name?: string; error?: string }> {
  try {
    await assertOwner();
    const f = fd.get("file");
    if (!(f instanceof File) || !f.size) return { error: "Chọn file Word" };
    if (/\.doc$/i.test(f.name)) return { error: "File .doc (Word cũ) chưa hỗ trợ – mở bằng Word và Lưu thành .docx rồi nhập lại" };
    if (!/\.docx$/i.test(f.name)) return { error: "Chỉ nhận file Word .docx" };
    if (f.size > 8 * 1024 * 1024) return { error: "File quá lớn (tối đa 8MB)" };
    const text = docxToText(Buffer.from(await f.arrayBuffer()));
    if (!text) return { error: "File Word không có chữ" };
    return { text, name: f.name };
  } catch (e) {
    return { error: (e as Error).message || "Không đọc được file Word" };
  }
}
