import Link from "next/link";
import { requireAdmin } from "@/lib/guards";
import { AdminLoginLog, AuditLog, PendingPhoto, ShiftTemplate, Store } from "@/lib/models";
import { getSettings } from "@/lib/settings";
import { prevMonth, viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Alert, Badge, Card, Field, Input, LinkButton, PageTitle } from "@/components/ui";
import { disconnectDrive, saveAutoCheckout, saveAutoPenalty, saveConfig, saveGoodsEnabled, saveUserAppAccess } from "../../actions/settings";
import { autoPenaltySummary } from "@/lib/auto-penalty";
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
  // Tự động check-out hết ca tối: cơ sở + giờ kết thúc ca muộn nhất (gợi ý giờ check-out)
  const acStores = await Store.find({ active: { $ne: false } }).select("name autoCheckoutOn autoCheckoutTime").sort({ name: 1 }).lean();
  const lastShiftEnd = new Map<string, string>();
  for (const t of await ShiftTemplate.find({ active: true }).select("storeId startTime endTime").lean()) {
    const k = String(t.storeId);
    // ca qua đêm (kết thúc < bắt đầu) coi như muộn nhất; còn lại lấy giờ kết thúc lớn nhất
    const end = t.endTime < t.startTime ? `~${t.endTime}` : t.endTime;
    const cur = lastShiftEnd.get(k);
    if (!cur || end > cur) lastShiftEnd.set(k, end);
  }
  for (const [k, v] of lastShiftEnd) lastShiftEnd.set(k, v.replace("~", ""));

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
          <Card title="❓ Help – Trợ giúp nhân viên">
            <p className="text-sm text-ink/70">
              Nội dung nút “?” trên app nhân viên: hướng dẫn sử dụng app (nhập từ file Word), quy trình làm việc theo vị trí (Bếp / Thu ngân / Ship / Đa năng), thông tin
              quán, các tình huống hay gặp (hỏi – đáp). Có xem trước.{" "}
              <Link className="text-accent underline" href="/admin/settings/help">Mở Cài đặt Help →</Link>
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
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" name="stockEnabled" defaultChecked={s.stockEnabled === true} className="mt-0.5 h-4 w-4" />
                <span>
                  <b>Bật Tồn kho (kiểm kho)</b> <span className="text-xs text-ink/60">– mặc định tắt</span>
                  <span className="block text-xs text-ink/60">
                    Nhân viên có thêm nút “Tồn kho” để báo số còn cuối ngày (gõ “tồn 3mn, 1nl…” / ảnh nhóm chat). Tổng hợp tháng khi đó tính tiêu thụ = tồn đầu + nhập − tồn cuối, thay vì chỉ theo số nhập.
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
            <ActionForm action={saveUserAppAccess} submitLabel="Lưu" successText="Đã lưu" className="mt-3 space-y-3 border-t border-[#f1e6c8] pt-3">
              <p className="text-xs text-ink/60">
                Gmail admin đăng nhập luôn vào trang quản lý. Cho từng admin vào app nhân viên: tick “Cho vào app nhân viên” ở từng tài khoản trong{" "}
                <Link className="text-accent underline" href="/admin/admins">Quản lý admin</Link>. Nhân viên cần quản lý dùng role quản lý ở app nhân viên.
              </p>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="ownerUserApp" defaultChecked={s.ownerUserApp === true} className="mt-0.5 h-4 w-4" />
                <span>
                  <b>Cho phép chính Admin Tổng vào app nhân viên</b>
                  <span className="block text-xs text-ink/60">Cần có hồ sơ nhân viên cho Gmail Admin Tổng (tạo ở Nhân viên → hồ sơ cho admin).</span>
                </span>
              </label>
            </ActionForm>
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

          <ActionForm action={saveAutoPenalty} submitLabel="Lưu phạt tự động" successText="Đã lưu – đã tính phạt theo dữ liệu hiện tại" className="mt-4 space-y-3 border-t border-[#f1e6c8] pt-4">
            <fieldset disabled={!isOwner} className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="autoPenaltyOn" defaultChecked={s.autoPenaltyOn === true} className="mt-0.5 h-4 w-4" />
                <span>
                  <b>Tự động phạt tiền</b> khi đi muộn, bỏ ca, quên chấm công
                  <span className="block text-xs text-ink/60">
                    Khoản phạt tự tạo ở Thưởng / phạt (ghi “phạt tự động”), tính vào bảng lương. Chạy mỗi giờ. Admin sửa giờ / duyệt bổ sung chấm công → khoản phạt tự cập nhật hoặc
                    xoá. Xoá một khoản phạt tự động = miễn phạt (không tạo lại). Tháng đã trả lương không bị đụng. Mức 0đ = không phạt loại đó.
                  </span>
                  {s.autoPenaltyOn && autoPenaltySummary(s) && <span className="mt-1 block text-xs font-semibold text-danger">Đang phạt: {autoPenaltySummary(s)}</span>}
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Áp dụng cho sự kiện từ ngày" hint="Trống = từ ngày bật. Tối đa 40 ngày gần nhất"><Input type="date" name="autoPenaltyFrom" defaultValue={s.autoPenaltyFrom ?? ""} /></Field>
                <Field label="Đi muộn (đ / lượt)" hint={`Muộn quá ngưỡng ${s.lateThresholdMinutes} phút so với giờ bắt đầu ca`}><Input name="penaltyLateVnd" inputMode="numeric" defaultValue={s.penaltyLateVnd || 0} /></Field>
                <Field label="Đi muộn – cộng thêm (đ / phút muộn)" hint="VD 1000 → muộn 15' thêm 15.000đ"><Input name="penaltyLatePerMinVnd" inputMode="numeric" defaultValue={s.penaltyLatePerMinVnd || 0} /></Field>
                <Field label="Bỏ ca (đ / ca)" hint="Có lịch ca đã duyệt nhưng không chấm công – xét sau khi ca kết thúc 2 giờ"><Input name="penaltyNoShowVnd" inputMode="numeric" defaultValue={s.penaltyNoShowVnd || 0} /></Field>
                <Field label="Quên check-out (đ / lượt)" hint={`Quá ${s.missingCheckoutHours} giờ / hết ca + 4 giờ chưa check-out`}><Input name="penaltyMissingOutVnd" inputMode="numeric" defaultValue={s.penaltyMissingOutVnd || 0} /></Field>
                <Field label="Quên check-in (đ / lượt)" hint="Lượt do admin chấm hộ / duyệt yêu cầu bổ sung chấm công"><Input name="penaltyMissingInVnd" inputMode="numeric" defaultValue={s.penaltyMissingInVnd || 0} /></Field>
              </div>
            </fieldset>
          </ActionForm>

          <ActionForm action={saveAutoCheckout} submitLabel="Lưu tự động check-out" successText="Đã lưu" className="mt-4 space-y-3 border-t border-[#f1e6c8] pt-4">
            <div className="text-sm">
              <b>Tự động check-out khi hết ca tối</b> – bật riêng từng cơ sở
              <span className="block text-xs text-ink/60">
                Tới giờ đặt (VD 23:00) mà nhân viên <b>được xếp ca tối</b> (Tối, hoặc Chiều + Tối liền) vẫn chưa check-out → hệ thống tự check-out <b>đúng giờ đó</b> và báo
                nhóm chấm công Telegram: “Có … nhân viên được tự động check-out”. Người không được xếp ca tối (VD ca Sáng + Chiều, ca Chiều) quên check-out → KHÔNG tự
                check-out, vẫn tính “quên check-out” như cũ. Sau khi tự check-out: nút chấm công mờ 2 tiếng kèm thông báo “Bạn đã được tự động check-out”.
              </span>
            </div>
            <fieldset disabled={!isOwner} className="divide-y divide-[#f1e6c8] rounded-xl ring-1 ring-[#f1e6c8]">
              {acStores.map((st) => {
                const id = String(st._id);
                return (
                  <div key={id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <input type="hidden" name="storeIds" value={id} />
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input type="checkbox" name={`ac_on_${id}`} defaultChecked={st.autoCheckoutOn === true} className="h-4 w-4" />
                      <span className="font-semibold">{st.name}</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-ink/70">
                      Check-out lúc
                      <Input type="time" name={`ac_time_${id}`} defaultValue={st.autoCheckoutTime || lastShiftEnd.get(id) || "23:00"} className="w-28" />
                    </label>
                    {lastShiftEnd.get(id) && <span className="text-[11px] text-ink/50">ca muộn nhất kết thúc {lastShiftEnd.get(id)}</span>}
                  </div>
                );
              })}
            </fieldset>
            <fieldset disabled={!isOwner} className="flex flex-wrap items-center gap-3 rounded-xl bg-cream px-3 py-2 ring-1 ring-[#f1e6c8]">
              <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                <input type="checkbox" name="quietCheckinOn" defaultChecked={s.quietCheckinOn !== false} className="mt-0.5 h-4 w-4" />
                <span>
                  <b>Giờ cấm check-in</b> (mọi cơ sở)
                  <span className="block text-xs text-ink/60">Trong khoảng này nút CHECK-IN mờ, không chấm công vào được. Check-out vẫn bấm được.</span>
                </span>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink/70">
                Từ <Input type="time" name="quietCheckinFrom" defaultValue={s.quietCheckinFrom || "01:00"} className="w-28" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-ink/70">
                đến <Input type="time" name="quietCheckinTo" defaultValue={s.quietCheckinTo || "06:00"} className="w-28" />
              </label>
            </fieldset>
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
