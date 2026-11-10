import { requirePerm } from "@/lib/guards";
import { Store, User } from "@/lib/models";
import { Badge, Card, PageTitle } from "@/components/ui";
import StoreForm from "./StoreForm";
import { ActionForm } from "@/components/ActionForm";
import { testRevenueSheet, testTelegram } from "../../actions/closing";
import { sheetLayoutOf } from "@/lib/revenue";

export const dynamic = "force-dynamic";

/** Quản lý cơ sở (spec 1.2, 3.4) */
export default async function StoresPage() {
  await requirePerm("stores");
  const stores = await Store.find().sort({ name: 1 }).lean();
  const counts = await User.aggregate<{ _id: string; n: number }>([{ $match: { status: "ACTIVE" } }, { $group: { _id: "$storeId", n: { $sum: 1 } } }]);
  const cnt = new Map(counts.map((c) => [String(c._id), c.n]));
  return (
    <>
      <PageTitle sub="Cơ sở chưa có toạ độ thì nhân viên chưa chấm công được">Cơ sở</PageTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        {stores.map((s) => (
          <Card
            key={String(s._id)}
            title={s.name}
            actions={
              <div className="flex gap-1">
                <Badge>{s.code}</Badge>
                <Badge tone="green">{cnt.get(String(s._id)) || 0} NV</Badge>
                {!s.active && <Badge tone="red">Đã ẩn</Badge>}
                {(s.lat == null || s.lng == null) && <Badge tone="orange">Chưa có toạ độ</Badge>}
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap justify-end gap-2">
              <ActionForm action={testTelegram} submitLabel="📨 Gửi thử Telegram" variant="outline" successText="Đã gửi tin nhắn thử vào nhóm" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="storeId" value={String(s._id)} />
              </ActionForm>
              {(s.telegramAttendanceChatId || process.env.TELEGRAM_ATTENDANCE_CHAT_ID) && (
                <ActionForm action={testTelegram} submitLabel="📨 Gửi thử nhóm chấm công" variant="outline" successText="Đã gửi tin nhắn thử vào nhóm chấm công" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="storeId" value={String(s._id)} />
                  <input type="hidden" name="kind" value="attendance" />
                </ActionForm>
              )}
              {(s.telegramGoodsChatId || process.env.TELEGRAM_GOODS_CHAT_ID) && (
                <ActionForm action={testTelegram} submitLabel="📨 Gửi thử nhóm nhận hàng" variant="outline" successText="Đã gửi tin nhắn thử vào nhóm nhận hàng" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="storeId" value={String(s._id)} />
                  <input type="hidden" name="kind" value="goods" />
                </ActionForm>
              )}
              {s.revenueSheetId && (
                <ActionForm action={testRevenueSheet} submitLabel="📊 Kiểm tra Google Sheet" variant="outline" successText="Ghi được Google Sheet, có tab tháng này" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="storeId" value={String(s._id)} />
                </ActionForm>
              )}
            </div>
            <StoreForm
              store={{
                id: String(s._id),
                code: s.code,
                name: s.name,
                address: s.address || "",
                lat: s.lat ?? null,
                lng: s.lng ?? null,
                radiusM: s.radiusM || 100,
                timezone: s.timezone || "Asia/Ho_Chi_Minh",
                telegramChatId: s.telegramChatId || "",
                telegramAttendanceChatId: s.telegramAttendanceChatId || "",
                telegramGoodsChatId: s.telegramGoodsChatId || "",
                revenueSheetId: s.revenueSheetId || "",
                revenueTabPattern: s.revenueTabPattern || "T{m}",
                revenueFirstRow: s.revenueFirstRow || 3,
                revenueSheetLayout: sheetLayoutOf(s),
                active: s.active !== false,
                checkFace: s.checkFace !== false,
                checkGps: s.checkGps !== false,
                checkWifi: s.checkWifi === true,
                wifiName: s.wifiName || "",
                wifiIps: s.wifiIps ?? [],
              }}
            />
          </Card>
        ))}
        <Card title="➕ Thêm cơ sở mới" className="border-2 border-dashed border-primary">
          <StoreForm store={null} />
        </Card>
      </div>
    </>
  );
}
