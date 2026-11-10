import GoodsAdmin, { type GoodsSearch } from "./GoodsAdmin";

export const dynamic = "force-dynamic";

/** Nhận hàng các cơ sở */
export default async function GoodsPage({ searchParams }: { searchParams: Promise<GoodsSearch> }) {
  return <GoodsAdmin kind="RECEIVE" sp={await searchParams} />;
}
