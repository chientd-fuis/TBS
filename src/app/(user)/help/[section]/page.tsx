import { notFound } from "next/navigation";
import { requireActiveUser } from "@/lib/guards";
import { getHelp } from "@/lib/help-server";
import RulesView from "@/components/RulesView";
import FaqList from "@/components/help/FaqList";
import WorkflowView from "@/components/help/WorkflowView";

export const dynamic = "force-dynamic";

const MAP = { guide: "guide", workflow: "workflow", about: "about", faq: "faq" } as const;

/** /help/guide · /help/workflow · /help/about · /help/faq */
export default async function HelpSection({ params }: { params: Promise<{ section: string }> }) {
  await requireActiveUser();
  const { section } = await params;
  const key = MAP[section as keyof typeof MAP];
  if (!key) notFound();
  const help = await getHelp();
  // đầu trang + hàng tab ở layout (HelpNav) – không dựng lại khi chuyển mục
  return (
    <div className="rounded-2xl bg-cream/40">
      {key === "guide" && <RulesView text={help.guide} empty="Chưa có hướng dẫn – admin cập nhật ở Cài đặt → Help." />}
      {key === "workflow" && <WorkflowView content={help.workflow} />}
      {key === "about" && <RulesView text={help.about} empty="Chưa có thông tin quán – admin cập nhật ở Cài đặt → Help." />}
      {key === "faq" && <FaqList items={help.faq} />}
    </div>
  );
}
