import GoodsUserPage from "./GoodsUserPage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default function ReceivePage() {
  return <GoodsUserPage kind="RECEIVE" />;
}
