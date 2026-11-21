import { ActionForm } from "@/components/ActionForm";
import { Card, Field, Select } from "@/components/ui";
import { RECALC_MAX_SHORT, RECALC_MODES, RECALC_THRESHOLDS, type RecalcMode } from "@/lib/hours-recalc";
import { saveHoursRecalc } from "../../actions/hours-recalc";

const hv = (n: number) => String(n).replace(".", ",");

/** Cài đặt → Tự động tính lại giờ công (Admin Tổng sửa, admin khác chỉ xem). */
export default function HoursRecalcCard({
  mode,
  threshold,
  maxShort,
  isOwner,
  last,
}: {
  mode: RecalcMode;
  threshold: number;
  maxShort: number;
  isOwner: boolean;
  last?: string;
}) {
  return (
    <div id="tinh-lai-gio-cong" className="scroll-mt-20">
      <Card title="⏱ Tự động tính lại giờ công">
        <p className="mb-3 text-sm text-ink/70">
          Giờ thực tế − giờ chấm công &gt; ngưỡng → cộng <b>+0,5h</b> cho các ca bị làm tròn xuống chỉ thiếu ít phút (ưu tiên ca thiếu ít nhất), tới khi chênh còn ≤ ngưỡng.
          Kết quả hiện <b className="text-[#c62828]">màu đỏ</b> ở cột Giờ công (Bảng chấm công → Tổng hợp tháng) và là số dùng để tính lương.
        </p>
        <ActionForm action={saveHoursRecalc} submitLabel="Lưu" successText="Đã lưu">
          <fieldset disabled={!isOwner} className="space-y-3">
            <div className="space-y-2">
              <p className="text-sm font-semibold">Khi nào tự tính</p>
              {RECALC_MODES.map((m) => (
                <label key={m.v} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-sm ${m.v === "monthEnd" ? "bg-ok-soft ring-1 ring-ok-line" : ""}`}>
                  <input type="radio" name="mode" value={m.v} defaultChecked={mode === m.v} className="mt-1 h-4 w-4 accent-secondary" />
                  <span>
                    <b>{m.label}</b>
                    {m.v === "monthEnd" && <span className="ml-1 rounded-full bg-secondary-dark px-2 py-0.5 text-[10px] font-semibold text-white">Mặc định</span>}
                    <span className="block text-xs text-ink/60">{m.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Bắt đầu tính khi chênh lớn hơn" hint="Tính tới khi chênh còn ≤ số này">
                <Select name="threshold" defaultValue={String(threshold)}>
                  {RECALC_THRESHOLDS.map((t) => (
                    <option key={t} value={t}>{hv(t)}h</option>
                  ))}
                </Select>
              </Field>
              <Field label="Chỉ cộng ca thiếu tối đa" hint="Phút còn thiếu tới mốc làm tròn kế tiếp (VD 4h53' thiếu 7' tới 5h)">
                <Select name="maxShort" defaultValue={String(maxShort)}>
                  {RECALC_MAX_SHORT.map((t) => (
                    <option key={t} value={t}>{t} phút</option>
                  ))}
                </Select>
              </Field>
            </div>
            <p className="rounded-xl bg-cream px-3 py-2 text-xs text-ink/70">
              Luôn giữ: không cộng quá giờ thực tế · không trừ giờ · bỏ qua ca thử việc, ca admin đã cộng tay · không đụng tháng đã trả lương · người admin bấm Huỷ thì
              tự động bỏ qua trong tháng đó. Mỗi ca cộng đúng 1 bước làm tròn (0,5h).
            </p>
          </fieldset>
        </ActionForm>
        {last && <p className="mt-2 text-xs text-ink/60">Lần tính gần nhất: {last}</p>}
      </Card>
    </div>
  );
}
