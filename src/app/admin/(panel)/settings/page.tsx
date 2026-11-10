import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdminLoginLog, AuditLog, PendingPhoto } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { prevMonth, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, LinkButton, PageTitle } from "@/components/ui";
import { disconnectDrive, saveConfig, saveGoodsEnabled } from "../../actions/settings";
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
        {isOwner && (
          <Card title="✨ Cài đặt AI">
            <p className="text-sm text-ink/70">
              Bật / tắt và giới hạn từng chức năng AI (kiểm soát token), nội dung Trợ lý cửa hàng, ngưỡng phát hiện bất thường.{" "}
              <Link className="text-accent underline" href="/admin/settings/ai">Mở Cài đặt AI →</Link>
            </p>
          </Card>
        )}

        {isOwner && (
          <Card title="📦 Nhận hàng các cơ sở">
            <ActionForm action={saveGoodsEnabled} submitLabel="Lưu" successText="Đã lưu">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="goodsEnabled" defaultChecked={s.goodsEnabled !== false} className="mt-0.5 h-4 w-4" />
                <span>
                  <b>Bật chức năng Nhận hàng</b>
                  <span className="block text-xs text-ink/60">
                    Tắt → nhân viên không thấy nút “Nhận hàng” dưới Chốt ca, admin không nhập mới được (dữ liệu cũ vẫn giữ). Riêng phần AI đọc ảnh / tin bật tắt ở{" "}
                    <Link className="text-accent underline" href="/admin/settings/ai">Cài đặt AI</Link> → “Đọc tin nhắn nhận hàng”.
                  </span>
                </span>
              </label>
            </ActionForm>
            <Link href="/admin/goods" className="mt-2 inline-block text-sm text-accent underline">Mở trang Nhận hàng →</Link>
          </Card>
        )}

        {isOwner && (
          <Card title="Tài khoản admin">
            <p className="text-sm text-ink/70">
              Admin đăng nhập bằng <b>Gmail</b> (không còn mật khẩu chung). Thêm / duyệt / phân quyền admin ở mục{" "}
              <Link className="text-accent underline" href="/admin/admins">Quản lý admin</Link>.
            </p>
          </Card>
        )}

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
              <Field label="Dung sai làm tròn mốc 0,5 (phút)" hint="VD 3 → 3h27' tính 3,5h (thiếu ≤ 3' tới mốc :30)"><Input name="roundGraceMinutes" defaultValue={s.roundGraceMinutes} /></Field>
              <Field label="Dung sai làm tròn mốc 1 giờ (phút)" hint="VD 4 → 3h56' tính 4h (thiếu ≤ 4' tới mốc tròn giờ)"><Input name="roundGraceHourMinutes" defaultValue={s.roundGraceHourMinutes ?? s.roundGraceMinutes} /></Field>
              <Field label="Ngưỡng đi muộn (phút)"><Input name="lateThresholdMinutes" defaultValue={s.lateThresholdMinutes} /></Field>
              <Field label="Ngưỡng về sớm (phút)"><Input name="earlyThresholdMinutes" defaultValue={s.earlyThresholdMinutes} /></Field>
              <Field label="Chặn check-out trong (phút) sau check-in"><Input name="minCheckoutMinutes" defaultValue={s.minCheckoutMinutes} /></Field>
              <Field label="Coi là quên check-out sau (giờ)"><Input name="missingCheckoutHours" defaultValue={s.missingCheckoutHours} /></Field>
              <Field label="Số thiết bị tối đa / nhân viên"><Input name="maxDevicesPerUser" defaultValue={s.maxDevicesPerUser} /></Field>
              <Field label="Sai số GPS tối đa (m)"><Input name="maxGpsAccuracyM" defaultValue={s.maxGpsAccuracyM} /></Field>
              <Field label="Phiên admin hết hạn sau (ngày)"><Input name="adminSessionDays" defaultValue={s.adminSessionDays} /></Field>
            </fieldset>
            {isOwner && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="recompute" className="mt-0.5 accent-[#3c9c54]" />
                <span>
                  Tính lại giờ công theo cách làm tròn mới cho <b>tháng này và tháng trước</b> (bỏ qua tháng đã chốt lương). Không tick = chỉ áp dụng cho lượt
                  chấm công mới.
                </span>
              </label>
            )}
            {!isOwner && <p className="text-xs text-ink/60">Chỉ Admin Tổng được thay đổi cấu hình.</p>}
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
