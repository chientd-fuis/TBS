import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { getSettings } from "@/lib/settings";
import { User } from "@/lib/models";
import { PRIVACY_TEMPLATE } from "@/lib/privacy";
import { viDateTime } from "@/lib/time";
import { PageTitle } from "@/components/ui";
import PrivacyEditor from "./PrivacyEditor";

export const dynamic = "force-dynamic";

/** Cài đặt → Quyền riêng tư: soạn Chính sách bằng Markdown, xem trước, phát hành (Admin Tổng). */
export default async function PrivacySettingsPage() {
  await requireOwner();
  const s = await getSettings();
  const version = s.privacyVersion ?? 0;
  const [active, agreed] = await Promise.all([
    User.countDocuments({ status: "ACTIVE", noLogin: { $ne: true } }),
    version > 0 ? User.countDocuments({ status: "ACTIVE", noLogin: { $ne: true }, privacyVersion: { $gte: version } }) : 0,
  ]);
  return (
    <>
      <PageTitle sub="Soạn bằng Markdown bên trái, xem trước bên phải – giống trang nhân viên thấy">
        <Link href="/admin/settings" className="text-sm font-normal underline">Cài đặt</Link> / Quyền riêng tư
      </PageTitle>
      <PrivacyEditor
        initial={s.privacyMd || ""}
        template={PRIVACY_TEMPLATE}
        version={version}
        publishedAt={s.privacyPublishedAt ? viDateTime(s.privacyPublishedAt) : ""}
        updatedAt={s.privacyUpdatedAt ? viDateTime(s.privacyUpdatedAt) : ""}
        stats={{ active, agreed }}
      />
    </>
  );
}
