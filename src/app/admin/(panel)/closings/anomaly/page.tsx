import Link from "next/link";
import { requireOwner } from "@/lib/guards";
import { latestAnomalyRun, SEV_LABEL, type Sev } from "@/lib/anomaly";
import { getAiConfig } from "@/lib/ai";
import { viDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Card, Empty, PageTitle } from "@/components/ui";
import { resolveAnomaly, runAnomalyNow } from "../../../actions/ai";

export const dynamic = "force-dynamic";
const TONE: Record<Sev, "red" | "orange" | "yellow"> = { 3: "red", 2: "orange", 1: "yellow" };
const vnd = (n: number) => Math.round(n).toLocaleString("vi-VN");
const dm = (d: string) => `${d.slice(8)}/${d.slice(5, 7)}`;

/** Bất thường chốt ca & két – rà theo từng nhân viên (Admin Tổng: có số tiền doanh thu từng ca). */
export default async function AnomalyPage() {
  await requireOwner();
  const [run, cfg] = await Promise.all([latestAnomalyRun(), getAiConfig()]);
  const open = run?.items.filter((i) => !i.resolved) ?? [];
  const count = (s: Sev) => open.filter((i) => i.sev === s).length;
  return (
    <>
      <PageTitle sub={`Hệ thống tự rà mỗi ngày (7 ngày gần nhất); AI viết tóm tắt. Ngưỡng chỉnh ở Cài đặt → AI. ${cfg.features.anomaly.enabled ? "" : "⚠ Chức năng đang TẮT."}`}>
        <Link href="/admin/closings" className="text-sm font-normal underline">Chốt ca</Link> / Bất thường chốt ca &amp; két
      </PageTitle>
      <div className="flex flex-wrap items-center gap-2">
        <ActionForm action={runAnomalyNow} submitLabel="Rà lại ngay" variant="outline" successText="Đã rà xong" className="flex items-center gap-2" />
        {run && <span className="text-xs text-ink/60">Lần rà gần nhất: {viDateTime(run.createdAt)} · kỳ {dm(run.from)} – {dm(run.to)}</span>}
      </div>
      {!run ? (
        <Empty>Chưa rà lần nào – bấm “Rà lại ngay”.</Empty>
      ) : (
        <>
          <Card title="✨ Tóm tắt">
            <p className="text-sm whitespace-pre-line">{run.summary}</p>
            <p className="mt-2 text-xs text-ink/60">Số liệu do hệ thống tính từ dữ liệu chốt ca (riêng từng ca); AI chỉ viết tóm tắt &amp; không kết luận thay bạn.</p>
          </Card>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([3, 2, 1] as Sev[]).map((s) => (
              <Card key={s}>
                <p className="text-xs text-ink/60">{SEV_LABEL[s]}</p>
                <p className={`text-2xl font-bold ${s === 3 ? "text-danger" : s === 2 ? "text-warn" : "text-accent"}`}>{count(s)}</p>
              </Card>
            ))}
            <Card>
              <p className="text-xs text-ink/60">Đã xử lý</p>
              <p className="text-2xl font-bold text-secondary-dark">{run.items.length - open.length}</p>
            </Card>
          </div>
          <Card title={`Danh sách (${run.items.length})`}>
            {!run.items.length ? (
              <Empty>Không có bất thường 🎉</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbs text-sm">
                  <thead><tr><th>Mức</th><th>Loại</th><th>Nhân viên</th><th>Cơ sở · Ca</th><th>Chi tiết</th><th></th></tr></thead>
                  <tbody>
                    {run.items.map((i) => (
                      <tr key={i.key} className={i.resolved ? "opacity-50" : ""}>
                        <td><Badge tone={i.resolved ? "gray" : TONE[i.sev]}>{i.resolved ? "Đã xử lý" : SEV_LABEL[i.sev]}</Badge></td>
                        <td className="whitespace-nowrap">{i.label}</td>
                        <td className="font-semibold">{i.staff}</td>
                        <td className="whitespace-nowrap text-xs">{i.storeName} · {i.shiftName} {dm(i.workDate)}</td>
                        <td className="text-xs">{i.detail}</td>
                        <td className="whitespace-nowrap">
                          <div className="flex flex-col gap-1 text-xs">
                            <Link className="text-accent underline" href={`/admin/closings?store=${i.storeId}&date=${i.workDate}`}>Mở lượt chốt ca →</Link>
                            <ActionForm action={resolveAnomaly} submitLabel={i.resolved ? "Bỏ đánh dấu" : "Đã xử lý"} variant="ghost" successText="">
                              <input type="hidden" name="key" value={i.key} />
                              {i.resolved && <input type="hidden" name="undo" value="1" />}
                            </ActionForm>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {run.byStaff.length > 0 && (
            <Card title="Theo nhân viên">
              <table className="tbs text-sm">
                <thead><tr><th>Nhân viên</th><th>Cơ sở</th><th className="text-right">Số ca chốt</th><th className="text-right">Ca thiếu tiền</th><th className="text-right">Tổng thiếu</th><th className="text-right">Cộng sai</th></tr></thead>
                <tbody>
                  {(run.byStaff as { staff: string; storeName: string; closings: number; shortCount: number; shortSum: number; wrongTotal: number }[]).map((s) => (
                    <tr key={`${s.staff}|${s.storeName}`}>
                      <td className="font-semibold">{s.staff}</td>
                      <td>{s.storeName}</td>
                      <td className="text-right">{s.closings}</td>
                      <td className={`text-right ${s.shortCount >= cfg.anomaly.negRepeat ? "font-bold text-danger" : ""}`}>{s.shortCount}</td>
                      <td className="text-right tabular-nums">{s.shortSum ? vnd(s.shortSum) : ""}</td>
                      <td className="text-right">{s.wrongTotal || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </>
  );
}
