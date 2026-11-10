import GoodsAdmin, { type GoodsSearch } from "../GoodsAdmin";

export const dynamic = "force-dynamic";

/** Tồn kho các cơ sở (mặc định tắt – bật ở Cài đặt) */
export default async function StockPage({ searchParams }: { searchParams: Promise<GoodsSearch> }) {
  return <GoodsAdmin kind="STOCK" sp={await searchParams} />;
}
