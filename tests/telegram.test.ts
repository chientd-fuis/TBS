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
  assert.match(text, /CHỐT CA – TBS Văn Phú/);
  assert.match(text, /Thứ 6, 06\/11\/2026/);
  assert.match(text, /Ca C \(13:00–18:00\)/);
  assert.match(text, /Người chốt: Tuấn Anh · 0957513908/);
  assert.match(text, /Vào ca 12:58 · Chốt lúc 18:05 \(5,1h\)/);
  assert.match(text, /Cùng ca: Bích Hằng, Ngọc Thanh/);
  assert.match(text, /#chotca #TBS_VP #ca_C/);
});
