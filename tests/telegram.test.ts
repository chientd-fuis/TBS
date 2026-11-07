import { test } from "node:test";
import assert from "node:assert/strict";
import { sendPhotosToTelegram } from "../src/lib/telegram";

test("gửi 1 ảnh → sendPhoto kèm caption", async () => {
  process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
  const calls: { url: string; body: FormData }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as FormData });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }));
  }) as typeof fetch;
  const ids = await sendPhotosToTelegram("-1001", [Buffer.from([1, 2, 3])], "CHỐT CA");
  assert.deepEqual(ids, [7]);
  assert.match(calls[0].url, /bot123:ABC\/sendPhoto$/);
  assert.equal(calls[0].body.get("chat_id"), "-1001");
  assert.equal(calls[0].body.get("caption"), "CHỐT CA");
});

test("gửi nhiều ảnh → sendMediaGroup, caption ở ảnh đầu", async () => {
  const calls: { url: string; body: FormData }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: init.body as FormData });
    return new Response(JSON.stringify({ ok: true, result: [{ message_id: 1 }, { message_id: 2 }, { message_id: 3 }] }));
  }) as typeof fetch;
  const ids = await sendPhotosToTelegram("-1001", [Buffer.from([1]), Buffer.from([2]), Buffer.from([3])], "cap");
  assert.deepEqual(ids, [1, 2, 3]);
  assert.match(calls[0].url, /sendMediaGroup$/);
  const media = JSON.parse(String(calls[0].body.get("media")));
  assert.equal(media.length, 3);
  assert.equal(media[0].caption, "cap");
  assert.equal(media[1].caption, undefined);
  assert.ok(calls[0].body.get("p2"));
});

test("Telegram báo lỗi → ném lỗi có mô tả", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }))) as unknown as typeof fetch;
  await assert.rejects(sendPhotosToTelegram("-1", [Buffer.from([1])], "x"), /chat not found/);
});

test("nội dung chốt ca: người chốt + ca + cùng ca", async () => {
  const { formatCaption } = await import("../src/lib/closing");
  const tz = "Asia/Ho_Chi_Minh";
  const at = (h: number, m: number) => new Date(Date.UTC(2026, 10, 6, h - 7, m));
  const text = formatCaption({
    storeName: "TBS Văn Phú",
    storeCode: "TBS-VP",
    tz,
    workDate: "2026-11-06",
    createdAt: at(18, 5),
    shiftName: "C",
    shiftStart: "13:00",
    shiftEnd: "18:00",
    employeeName: "Tuấn Anh",
    employeePhone: "0957513908",
    checkInAt: at(12, 58),
    coworkers: ["Bích Hằng", "Ngọc Thanh"],
    note: "Tiền mặt 2.350.000",
  });
  console.log(text);
  assert.match(text, /^🧾 CHỐT CA\n📅 Ngày: 06\/11 \(Thứ 6\)\n🏪 Cơ sở: Văn Phú\n👤 Thu ngân: Tuấn Anh/);
  assert.match(text, /Ca C \(13:00–18:00\)/);
  assert.match(text, /Thu ngân: Tuấn Anh · 0957513908/);
  assert.match(text, /Vào ca 12:58 · Chốt lúc 18:05 \(5,1h\)/);
  assert.match(text, /Cùng ca: Bích Hằng, Ngọc Thanh/);
  assert.match(text, /#chotca #TBS_VP #ca_C/);
});

test("caption có doanh thu ca", async () => {
  const { formatCaption } = await import("../src/lib/closing");
  const cap = formatCaption({
    storeName: "TBS Geleximco",
    storeCode: "TBS_GL",
    tz: "Asia/Ho_Chi_Minh",
    workDate: "2026-11-06",
    createdAt: new Date("2026-11-06T15:30:00Z"),
    shiftName: "T",
    shiftStart: "18:00",
    shiftEnd: "22:30",
    employeeName: "Tuấn Anh",
    revenue: { dt: 7060000, tm: 1328000, tk: 5610000, cp: 50000, grab: 72000, shopee: 0 },
    revenueInput: { cp: "30k sữa chua + 20k ship" },
  });
  assert.match(cap, /Doanh thu máy: 7\.060\.000đ/);
  assert.match(cap, /Tiền mặt 1\.328\.000đ · Tài khoản 5\.610\.000đ/);
  assert.match(cap, /Thu chi 50\.000đ \(30k sữa chua \+ 20k ship\)/);
  assert.match(cap, /✅ Âm\/Dương: 0đ/);
});

test("thông báo chấm công: check-in muộn, check-out sớm", async () => {
  const { formatAttendanceCaption } = await import("../src/lib/attendance-notify");
  const tz = "Asia/Ho_Chi_Minh";
  const at = (hh: number, mm: number) => new Date(Date.UTC(2026, 10, 7, hh - 7, mm));
  const cin = formatAttendanceCaption({
    action: "CHECK_IN", storeName: "TBS Văn Phú", employeeName: "Tuấn Anh", tz, workDate: "2026-11-07",
    checkInAt: at(8, 12), shiftLabel: "S 08:00–13:00", lateMinutes: 12,
  });
  assert.equal(cin, "✅ CHECK-IN\n🏪 Cơ sở: Văn Phú\n👤 Nhân viên: Tuấn Anh\n📅 Ngày: 07/11 (Thứ 7)\n🕐 Vào: 08:12\n⏰ Ca: S 08:00–13:00\n⚠️ Đi muộn 12 phút");
  const cout = formatAttendanceCaption({
    action: "CHECK_OUT", storeName: "TBS Văn Phú", employeeName: "Tuấn Anh", tz, workDate: "2026-11-07",
    checkInAt: at(8, 12), checkOutAt: at(12, 50), roundedHours: 4.5, earlyMinutes: 10, outOfShift: false,
  });
  assert.match(cout, /🕐 Vào: 08:12 · Ra: 12:50 · 4,5h công/);
  assert.match(cout, /⚠️ Về sớm 10 phút/);
});
