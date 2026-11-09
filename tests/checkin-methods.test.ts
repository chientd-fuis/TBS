import { test } from "node:test";
import assert from "node:assert/strict";
import { anyMethods, ipAllowed, methodsOf, normalizeIp, parseIpList } from "../src/lib/checkin-methods";

test("cách chấm công: mặc định khuôn mặt + vị trí bật, WiFi tắt", () => {
  assert.deepEqual(methodsOf({}), { face: true, gps: true, wifi: false });
  assert.deepEqual(methodsOf(null), { face: true, gps: true, wifi: false });
  assert.deepEqual(methodsOf({ checkFace: false, checkGps: false, checkWifi: true }), { face: false, gps: false, wifi: true });
  assert.deepEqual(anyMethods([methodsOf({ checkGps: false }), methodsOf({ checkFace: false, checkWifi: true })]), { face: true, gps: true, wifi: true });
});

test("IP WiFi: IPv4 khớp đúng, IPv6 khớp cả dải /64", () => {
  assert.equal(normalizeIp(" 113.190.12.34 "), "113.190.12.34");
  assert.equal(normalizeIp("::ffff:113.190.12.34"), "113.190.12.34");
  assert.equal(normalizeIp("2402:800:6371:a0f1:1c2d:3e4f:5a6b:7c8d"), "2402:800:6371:a0f1::/64");
  assert.equal(normalizeIp("2402:0800:6371:00f1::1"), "2402:800:6371:f1::/64");
  assert.equal(normalizeIp("2402:800::1"), "2402:800:0:0::/64");
  const list = parseIpList("113.190.12.34, 2402:800:6371:a0f1:aaaa::1\n# ghi chú\nabc 999.1.1.1");
  assert.deepEqual(list, ["113.190.12.34", "2402:800:6371:a0f1::/64"]);
  assert.equal(ipAllowed("113.190.12.34", list), true);
  assert.equal(ipAllowed("113.190.12.35", list), false); // 4G / mạng khác
  assert.equal(ipAllowed("2402:800:6371:a0f1:ffff:1:2:3", list), true); // máy khác cùng WiFi quán (IPv6)
  assert.equal(ipAllowed("2402:800:6371:a0f2::1", list), false);
  assert.equal(ipAllowed("", list), false);
});
