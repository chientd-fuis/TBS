import { connectDB } from "./db";
import { Settings } from "./models";
import { normalizeHelp } from "./help";

/** Nội dung Help hiện tại (Settings.help). */
export async function getHelp() {
  await connectDB();
  const s = await Settings.findOne({ key: "main" }).select("help").lean();
  return normalizeHelp(s?.help);
}
