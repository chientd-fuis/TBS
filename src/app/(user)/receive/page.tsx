import GoodsUserPage from "./GoodsUserPage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Hàng hoá – tab Nhận (mặc định) / Trả (?tab=return). Tồn kho ở /stock (cùng thanh tab). */
export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  return <GoodsUserPage kind={sp.tab === "return" ? "RETURN" : "RECEIVE"} />;
}
