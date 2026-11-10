import GoodsUserPage from "../receive/GoodsUserPage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Tồn kho – mặc định tắt (Admin Tổng bật ở Cài đặt) */
export default function StockPage() {
  return <GoodsUserPage kind="STOCK" />;
}
