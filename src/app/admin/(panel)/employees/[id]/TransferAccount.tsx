"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Alert, Button, Field, Select } from "@/components/ui";
import type { MergePreview } from "@/lib/account-merge";
import { previewAccountTransfer, transferAccount } from "../../../actions/people";

type Cand = { id: string; email: string; name: string; status: string };
const ST: Record<string, string> = { NEW: "mới đăng nhập", PENDING: "chờ duyệt", ACTIVE: "đang làm", REJECTED: "đã từ chối", INACTIVE: "nghỉ việc" };

/** Chuyển toàn bộ dữ liệu của tài khoản (Gmail) này sang tài khoản Gmail mới của nhân viên, rồi xoá tài khoản này. */
export default function TransferAccount({ fromId, fromEmail, fromName, candidates }: { fromId: string; fromEmail: string; fromName: string; candidates: Cand[] }) {
  const router = useRouter();
  const [toId, setToId] = useState("");
  const [pv, setPv] = useState<MergePreview | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [err, setErr] = useState("");
  const [agree, setAgree] = useState(false);
  const to = candidates.find((c) => c.id === toId);

  async function preview(id: string) {
    setToId(id);
    setPv(null);
    setErr("");
    setAgree(false);
    if (!id) return;
    setBusy("preview");
    const r = await previewAccountTransfer(fromId, id);
    setBusy("");
    if (r.ok) setPv(r.preview);
    else setErr(r.error);
  }

  async function run() {
    if (!to || !pv) return;
    if (!window.confirm(`Chuyển toàn bộ dữ liệu của ${fromName} từ ${fromEmail} sang ${to.email}?\n\nTài khoản ${fromEmail} sẽ bị XOÁ và không khôi phục được.`)) return;
    setBusy("save");
    setErr("");
    const r = await transferAccount(fromId, to.id);
    if (r.ok) router.replace(`/admin/employees/${r.toId}?transferred=1`);
    else {
      setBusy("");
      setErr(r.error);
    }
  }

  const total = pv ? Object.values(pv.counts).reduce((a, b) => a + b, 0) : 0;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-ink/70">
        Dùng khi nhân viên đổi sang Gmail mới: nhờ nhân viên <b>đăng nhập app bằng Gmail mới</b> trước (tài khoản mới sẽ hiện trong danh sách dưới), rồi chọn
        để chuyển toàn bộ chấm công, ca, chốt ca, lương, thưởng/phạt, thiết bị, khuôn mặt… sang. Hồ sơ (tên, SĐT, ngân hàng, lương giờ, cơ sở) lấy theo tài khoản
        cũ. Xong sẽ <b>xoá tài khoản {fromEmail}</b>.
      </p>
      <Field label="Tài khoản Gmail mới">
        <Select value={toId} onChange={(e) => void preview(e.target.value)} disabled={busy === "save"}>
          <option value="">— Chọn Gmail mới —</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.email}
              {c.name ? ` – ${c.name}` : ""} ({ST[c.status] ?? c.status})
            </option>
          ))}
        </Select>
      </Field>
      {!candidates.length && <p className="text-xs text-warn">Chưa có tài khoản nào khác – nhờ nhân viên đăng nhập bằng Gmail mới trước.</p>}
      {busy === "preview" && (
        <p className="flex items-center gap-1.5 text-ink/60">
          <Loader2 size={14} className="animate-spin" /> Đang kiểm tra dữ liệu…
        </p>
      )}
      {to && to.status === "ACTIVE" && <Alert tone="orange">Tài khoản {to.email} đang là nhân viên đang làm – kiểm tra kỹ đúng là cùng một người.</Alert>}
      {pv && (
        <div className="rounded-xl bg-cream p-3">
          <p className="mb-1 font-semibold">Sẽ chuyển sang {to?.email}:</p>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-3">
            {Object.entries(pv.counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{k}</span>
                  <b className="tabular-nums">{n}</b>
                </li>
              ))}
            {!total && <li className="text-ink/60">Tài khoản cũ chưa có dữ liệu – chỉ chép hồ sơ.</li>}
          </ul>
          {pv.notes.map((n) => (
            <p key={n} className="mt-1 text-xs text-ink/70">• {n}</p>
          ))}
        </div>
      )}
      {pv?.blockers.map((b) => (
        <Alert key={b} tone="red">{b}</Alert>
      ))}
      {err && <Alert tone="red">{err}</Alert>}
      {pv && !pv.blockers.length && (
        <>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" className="mt-0.5 accent-secondary" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>
              Tôi đã xác nhận {to?.email} đúng là Gmail mới của <b>{fromName}</b>. Tài khoản {fromEmail} sẽ bị xoá vĩnh viễn.
            </span>
          </label>
          <Button type="button" variant="danger" disabled={!agree || busy === "save"} onClick={() => void run()}>
            {busy === "save" ? <Loader2 size={16} className="animate-spin" /> : <ArrowRightLeft size={16} />}
            {busy === "save" ? "Đang chuyển…" : "Chuyển dữ liệu & xoá tài khoản cũ"}
          </Button>
        </>
      )}
    </div>
  );
}
