import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdminLoginLog, AuditLog, PendingPhoto } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { prevMonth, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, LinkButton, PageTitle } from "@/components/ui";
import { changeAdminPassword } from "../../actions/auth";
import { disconnectDrive, saveConfig } from "../../actions/settings";
import CleanupCard from "./CleanupCard";
import { lastAutoCleanup, latestCutoff, safeCutoff } from "@/lib/cleanup";

export const dynamic = "force-dynamic";

// dọn dữ liệu (xoá thư mục Drive) có thể chạy lâu
export const maxDuration = 60;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ drive?: string; msg?: string }> }) {
  const admin = await requireAdmin();
  const isOwner = admin.kind === "OWNER";
  const sp = await searchParams;
  const s = await getSettings();
  // tháng mốc để dọn: từ (tháng này − 2) lùi về 24 tháng
  const cleanupMonths: string[] = [];
  for (let m = latestCutoff(), i = 0; i < 27; i++, m = prevMonth(m)) cleanupMonths.push(m); // gồm cả "xoá tháng này / tháng trước"
  const [logs, audits, pending] = isOwner
    ? await Promise.all([
        AdminLoginLog.find().sort({ createdAt: -1 }).limit(30).lean(),
        AuditLog.find().sort({ createdAt: -1 }).limit(50).lean(),
        PendingPhoto.countDocuments(),
      ])
    : [[], [], 0];

  return (
    <>
      <PageTitle>Cài đặt</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={isOwner ? "Mật khẩu admin chung" : "Đổi mật khẩu"}>
          <p className="mb-3 text-xs text-ink/70">
            {s.adminPasswordChangedAt ? `Đổi lần cuối: ${viDateTime(s.adminPasswordChangedAt)}. ` : "Chưa đặt mật khẩu. "}
            Sau khi đổi, <b>tất cả admin đang đăng nhập bằng mật khẩu cũ sẽ bị đăng xuất</b>.
          </p>
          <ActionForm action={changeAdminPassword} submitLabel={s.adminPasswordHash ? "Đổi mật khẩu" : "Đặt mật khẩu"} successText="Đã đổi mật khẩu">
            {(!isOwner || s.adminPasswordHash) && (
              <Field label={isOwner ? "Mật khẩu hiện tại (Chủ có thể bỏ trống để đặt lại)" : "Mật khẩu hiện tại"}>
                <Input type="password" name="current" required={!isOwner} autoComplete="current-password" />
              </Field>
            )}
            <Field label="Mật khẩu mới" hint="Tối thiểu 8 ký tự, có chữ và số"><Input type="password" name="next" required autoComplete="new-password" /></Field>
            <Field label="Nhập lại mật khẩu mới"><Input type="password" name="confirm" required autoComplete="new-password" /></Field>
          </ActionForm>
        </Card>

        {isOwner && (
          <Card title="Kết nối Google Drive (lưu ảnh chấm công)">
            {sp.drive === "ok" && <Alert tone="green">Đã kết nối Google Drive.</Alert>}
            {sp.drive && sp.drive !== "ok" && <Alert tone="red">Kết nối thất bại: {sp.msg || sp.drive}</Alert>}
            <div className="my-3 space-y-1 text-sm">
              <p>
                Trạng thái: {s.googleRefreshTokenEnc ? <Badge tone="green">Đã kết nối</Badge> : <Badge tone="red">Chưa kết nối</Badge>}
              </p>
              {s.googleAccountEmail && <p>Tài khoản: <b>{s.googleAccountEmail}</b></p>}
              {s.googleConnectedAt && <p className="text-xs text-ink/60">Kết nối lúc {viDateTime(s.googleConnectedAt)}</p>}
              {s.rootDriveFolderId && (
                <p><a className="text-accent underline" target="_blank" href={`https://drive.google.com/drive/folders/${s.rootDriveFolderId}`}>Mở thư mục ảnh trên Drive</a></p>
              )}
              {pending > 0 && <p className="text-warn">{pending} ảnh đang chờ upload lại lên Drive.</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href="/api/google/connect" prefetch={false}>{s.googleRefreshTokenEnc ? "Kết nối lại" : "Kết nối Google Drive"}</LinkButton>
              {s.googleRefreshTokenEnc && (
                <ActionForm action={disconnectDrive} submitLabel="Ngắt kết nối" variant="outline" successText="" confirm="Ngắt kết nối Drive? Ảnh mới sẽ được giữ tạm cho tới khi kết nối lại." className="inline-block" />
              )}
            </div>
            <p className="mt-2 text-xs text-ink/60">App chỉ xin quyền với các file do app tạo (drive.file).</p>
          </Card>
        )}

        <Card title="Cấu hình chấm công">
          <ActionForm action={saveConfig} submitLabel="Lưu cấu hình" successText="Đã lưu">
            <fieldset disabled={!isOwner} className="grid gap-3 sm:grid-cols-2">
              <Field label="Bước làm tròn (giờ)" hint="0,5 → 4h45' = 4,5h (làm tròn xuống)"><Input name="roundStepHours" defaultValue={s.roundStepHours} /></Field>
              <Field label="Dung sai làm tròn (phút)" hint="VD 5 → 14h55' tính 15h. Mặc định 0"><Input name="roundGraceMinutes" defaultValue={s.roundGraceMinutes} /></Field>
              <Field label="Ngưỡng đi muộn (phút)"><Input name="lateThresholdMinutes" defaultValue={s.lateThresholdMinutes} /></Field>
              <Field label="Ngưỡng về sớm (phút)"><Input name="earlyThresholdMinutes" defaultValue={s.earlyThresholdMinutes} /></Field>
              <Field label="Chặn check-out trong (phút) sau check-in"><Input name="minCheckoutMinutes" defaultValue={s.minCheckoutMinutes} /></Field>
              <Field label="Coi là quên check-out sau (giờ)"><Input name="missingCheckoutHours" defaultValue={s.missingCheckoutHours} /></Field>
              <Field label="Số thiết bị tối đa / nhân viên"><Input name="maxDevicesPerUser" defaultValue={s.maxDevicesPerUser} /></Field>
              <Field label="Sai số GPS tối đa (m)"><Input name="maxGpsAccuracyM" defaultValue={s.maxGpsAccuracyM} /></Field>
              <Field label="Phiên admin hết hạn sau (ngày)"><Input name="adminSessionDays" defaultValue={s.adminSessionDays} /></Field>
            </fieldset>
            {!isOwner && <p className="text-xs text-ink/60">Chỉ Chủ được thay đổi cấu hình.</p>}
          </ActionForm>
        </Card>

        {isOwner && (
          <Card title="Lịch sử đăng nhập admin">
            <ul className="max-h-80 space-y-1 overflow-auto text-xs">
              {logs.map((l) => (
                <li key={String(l._id)}>
                  {viDateTime(l.createdAt)} · {l.success ? <Badge tone="green">OK</Badge> : <Badge tone="red">Sai</Badge>} {l.displayName} · IP {l.ip}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      {isOwner && <CleanupCard months={cleanupMonths} safe={safeCutoff()} autoCleanup={!!s.autoCleanup} lastAuto={await lastAutoCleanup().catch(() => null)} />}
      {isOwner && (
        <Card title="Nhật ký thao tác (50 gần nhất)">
          <div className="max-h-96 overflow-auto">
            <table className="tbs">
              <thead><tr><th>Thời gian</th><th>Người</th><th>Thao tác</th><th>Đối tượng</th></tr></thead>
              <tbody>
                {audits.map((a) => (
                  <tr key={String(a._id)}>
                    <td className="whitespace-nowrap text-xs">{viDateTime(a.createdAt)}</td>
                    <td className="text-xs">{a.actorName}</td>
                    <td className="text-xs">{a.action}</td>
                    <td className="text-xs">{a.targetType} {a.targetId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs"><Link href="/admin" className="underline">← Tổng quan</Link></p>
        </Card>
      )}
    </>
  );
}
