import { redirect } from "next/navigation";
import { requireActiveUser } from "@/lib/guards";
import { Alert } from "@/components/ui";

const ORDER = [
  ["schedule", "/manage/schedule"],
  ["bonus", "/manage/bonus"],
  ["cover", "/manage/requests"],
] as const;

/** Vào tab đầu tiên được cấp quyền. */
export default async function ManageHome({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireActiveUser();
  const { error } = await searchParams;
  const first = ORDER.find(([p]) => user.managerPerms?.includes(p));
  if (first && !error) redirect(first[1]);
  return <Alert tone="red">{error === "store" ? "Bạn không được giao quản lý cơ sở này." : "Bạn chưa được cấp quyền cho chức năng này."}</Alert>;
}
