import { qtyVi, type GoodsLine } from "@/lib/goods";

/**
 * Nội dung 1 lần nhận / tồn kho (dùng chung admin + nhân viên):
 * nội dung gốc (“em nhận 5,8kg mít…”) + các món app hiểu được, dạng thẻ dễ đọc.
 */
export function GoodsEntry({ raw, items, note, sender }: { raw?: string | null; items: GoodsLine[]; note?: string | null; sender?: string | null }) {
  return (
    <div className="mt-1 space-y-1.5">
      {raw && (
        <p className="rounded-lg border-l-4 border-primary bg-cream px-2.5 py-1.5 text-sm whitespace-pre-line text-ink/80 italic">
          {sender && <b className="not-italic text-ink/60">{sender}: </b>}“{raw}”
        </p>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {items.map((l) => (
          <li key={l.name} className={`rounded-lg px-2 py-0.5 text-sm ring-1 ${l.qty === 0 ? "bg-[#fdecec] ring-danger/30" : "bg-white ring-[#f1e6c8]"}`}>
            {l.name}{" "}
            {l.qty === 0 ? (
              <b className="text-danger">hết</b>
            ) : (
              <>
                <b className="tabular-nums">{qtyVi(l.qty)}</b>
                {l.unit ? ` ${l.unit}` : ""}
              </>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="text-xs text-ink/70">📝 {note}</p>}
    </div>
  );
}
