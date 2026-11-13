"use server";
import { revalidatePath } from "next/cache";
import { connectDB } from "@/lib/db";
import { Attendance, ProbationRequest, User } from "@/lib/models";
import { assertAdmin } from "@/lib/guards";
import { adminActor } from "@/lib/admin-session";
import { audit } from "@/lib/audit";
import { localDate } from "@/lib/time";
import { makeOfficial, probationConfig } from "@/lib/probation";
import { errMsg, str, type FormState } from "./types";

/**
 * Admin xác nhận yêu cầu thử việc (mọi admin – như duyệt nhân viên; tên admin phụ trách cơ sở chỉ để gắn trách nhiệm):
 *  - TRIAL (hết 3 ca thử việc): Nhận → làm tiếp (tắt "tháng thử việc" → chính thức 22k từ ca thứ 4) ·
 *    Không nhận → cho nghỉ việc (khoá tài khoản), 3 ca thử việc vẫn trả theo giờ đã tính.
 *  - MONTH (hết tháng thử việc): Đồng ý → chính thức 22k từ ngày hết thử việc · Chưa → gia hạn thử việc thêm 1 tháng.
 */
export async function resolveProbation(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const admin = await assertAdmin();
    await connectDB();
    const actor = adminActor(admin);
    const approve = str(fd.get("op")) !== "reject";
    const reply = str(fd.get("reply")).slice(0, 200);
    // giữ yêu cầu (nguyên tử): 2 admin cùng bấm → người sau nhận "đã được xử lý"
    const req = await ProbationRequest.findOneAndUpdate(
      { _id: str(fd.get("id")), status: "PENDING" },
      { $set: { status: approve ? "APPROVED" : "REJECTED", decidedBy: actor.name, decidedAt: new Date(), reply } },
      { returnDocument: "after" },
    ).lean();
    if (!req) return { error: "Yêu cầu đã được xử lý – tải lại trang" };
    const today = localDate(new Date());
    let result = "";
    try {
      const user = await User.findById(req.userId);
      if (!user) throw new Error("Không tìm thấy nhân viên");
      if (req.kind === "TRIAL") {
        if (approve) {
          user.set({ trialStage: "DONE" });
          await user.save();
          const { monthOn } = await probationConfig();
          if (!monthOn && user.probation) {
            // không có tháng thử việc → chính thức 22k từ ca thứ 4 (chưa làm thì từ hôm nay)
            const last = await Attendance.findOne({ _id: { $in: req.attendanceIds ?? [] } }).sort({ checkInAt: -1 }).select("checkInAt").lean();
            const next = last ? await Attendance.findOne({ userId: user._id, checkInAt: { $gt: last.checkInAt } }).sort({ checkInAt: 1 }).select("workDate").lean() : null;
            const r = await makeOfficial(user._id, next?.workDate ?? today, actor.name);
            result = `official ${r.wage} from ${next?.workDate ?? today}`;
          } else result = "continue probation";
        } else {
          user.set({ status: "INACTIVE", probation: false, probationEndedAt: new Date(), trialStage: "DONE" });
          await user.save();
          result = "inactive";
        }
      } else if (approve) {
        const r = await makeOfficial(user._id, req.periodEnd || today, actor.name);
        result = `official ${r.wage} from ${req.periodEnd || today}`;
      } else {
        // gia hạn thử việc thêm 1 tháng tính từ ngày hết thử việc → hết tháng hỏi lại
        user.set({ probationStart: req.periodEnd || today, probationReview: false });
        await user.save();
        result = `extend from ${req.periodEnd || today}`;
      }
    } catch (e) {
      // lỗi → trả yêu cầu về chờ duyệt
      await ProbationRequest.updateOne({ _id: req._id }, { $set: { status: "PENDING" }, $unset: { decidedBy: 1, decidedAt: 1, reply: 1 } });
      throw e;
    }
    await audit(actor, `user.probation.${req.kind === "TRIAL" ? "trial" : "month"}.${approve ? "approve" : "reject"}`, { type: "User", id: String(req.userId) }, null, {
      result,
      reply,
    });
    revalidatePath("/admin", "layout");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}
