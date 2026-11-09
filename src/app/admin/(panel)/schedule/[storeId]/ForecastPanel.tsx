"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, X } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import { weekdayVi } from "@/lib/time";
import { applyForecast, getForecast, type ForecastView } from "../../../actions/ai";

const tr = (n: number) => `~${(n / 1_000_000).toFixed(1).replace(".", ",")}tr`;

/** Nút "Gợi ý số người (AI)" → bảng ca × ngày: số người gợi ý (±so với định mức), doanh thu dự báo (Admin Tổng), lý do; áp dụng làm định mức tuần. */
export default function ForecastPanel({ storeId, weekStart }: { storeId: string; weekStart: string }) {
  const router = useRouter();
  const [data, setData] = useState<ForecastView | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const load = () =>
    start(async () => {
      setErr("");
      setMsg("");
      const r = await getForecast(storeId, weekStart).catch(() => ({ error: "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút" }) as Awaited<ReturnType<typeof getForecast>>);
      if (r.error) setErr(r.error);
      else setData(r.data!);
    });
  const apply = () =>
    start(async () => {
      if (!data) return;
      const r = await applyForecast(storeId, weekStart, data.cells.map((c) => ({ tplId: c.tplId, date: c.date, target: c.suggest }))).catch(() => ({ error: "Mất kết nối hoặc AI trả lời quá lâu – thử lại sau ít phút" }) as Awaited<ReturnType<typeof applyForecast>>);
      if (r.error) setErr(r.error);
      else {
        setMsg("Đã áp dụng làm định mức cho tuần này. Bấm “Xếp tự động” (lấp tới định mức) để xếp người.");
        router.refresh();
      }
    });

  if (!data)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" onClick={load} disabled={pending}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Gợi ý số người / ca (AI)
        </Button>
        {err && <span className="text-sm text-danger">{err}</span>}
      </div>
    );
  const cell = (tplId: string, date: string) => data.cells.find((c) => c.tplId === tplId && c.date === date);
  return (
    <Card
      title="✨ Gợi ý số người / ca"
      actions={
        <button type="button" onClick={() => setData(null)} aria-label="Đóng" className="text-ink/60">
          <X size={18} />
        </button>
      }
    >
      <p className="mb-2 text-xs text-ink/60">Dựa trên doanh thu chốt ca ~{data.weeks} tuần gần nhất (cùng thứ trong tuần, ngày lễ nhân hệ số). ↑ / ↓ = so với định mức hiện tại.</p>
      <div className="overflow-x-auto">
        <table className="tbs text-center text-sm">
          <thead>
            <tr>
              <th className="text-left">Ca</th>
              {data.days.map((d) => (
                <th key={d} className={data.holidayNames[d] ? "bg-[#fde8e8]" : ""}>
                  {weekdayVi(d).replace("Thứ ", "T").replace("Chủ Nhật", "CN")} {d.slice(8)}/{d.slice(5, 7)}
                  {data.holidayNames[d] && <div className="text-[10px] font-normal text-danger">{data.holidayNames[d]}</div>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.templates.map((t) => (
              <tr key={t.id}>
                <td className="text-left font-semibold">{t.name}</td>
                {data.days.map((d) => {
                  const c = cell(t.id, d)!;
                  const delta = c.suggest - c.current;
                  return (
                    <td key={d} className={data.holidayNames[d] ? "bg-[#fff5f5]" : ""}>
                      <b className="text-lg">{c.suggest}</b>{" "}
                      {delta !== 0 && <span className={`text-xs font-bold ${delta > 0 ? "text-secondary-dark" : "text-warn"}`}>{delta > 0 ? `↑${delta}` : `↓${-delta}`}</span>}
                      {c.rev != null && c.rev > 0 && <div className="text-[11px] text-ink/60">{tr(c.rev)}</div>}
                      {c.samples === 0 && <div className="text-[10px] text-ink/40">chưa có dữ liệu</div>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.explanation && <p className="mt-3 rounded-xl bg-primary-light p-3 text-sm">{data.explanation}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="button" onClick={apply} disabled={pending}>
          {pending && <Loader2 size={16} className="animate-spin" />} Áp dụng làm định mức tuần này
        </Button>
        <span className="text-xs text-ink/60">Chỉ đổi định mức người/ca của 7 ngày này (không đổi định mức chung, không tự xếp ai).</span>
      </div>
      {msg && <Alert tone="green">{msg}</Alert>}
      {err && <Alert tone="red">{err}</Alert>}
    </Card>
  );
}
