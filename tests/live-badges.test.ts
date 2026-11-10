import { test } from "node:test";
import assert from "node:assert/strict";
import { liveBadges, type Win } from "../src/lib/live-badges";

const t = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);
const S: Win = { start: t(8), end: t(13) };
const C: Win = { start: t(13), end: t(18) };
const T: Win = { start: t(18), end: t(23) };
const kinds = (checkIn: number, now: number, assigned: Win[], tpl: Win[] = [S, C, T]) => liveBadges(checkIn, now, assigned, tpl).map((b) => b.text);

test("Mới đến: vào trước ca < 30' hoặc sau giờ ca < 15'; chỉ hiện 30' đầu", () => {
  assert.deepEqual(kinds(t(12, 31), t(12, 40), [C]), ["Mới đến"]);
  assert.deepEqual(kinds(t(13, 14), t(13, 20), [C]), ["Mới đến"]);
  assert.deepEqual(kinds(t(13, 16), t(13, 20), [C]), []);
  assert.deepEqual(kinds(t(12, 51), t(13, 30), [C]), []); // quá 30' sau khi vào
  // không có lịch → theo ca của cơ sở: 12:51 là đến cho ca Chiều, không phải "sắp hết ca Sáng"
  assert.deepEqual(kinds(t(12, 51), t(12, 55), []), ["Mới đến"]);
});

test("Làm thêm giờ: đến sớm > 30' / quá giờ hết ca > 30'", () => {
  assert.deepEqual(kinds(t(12, 20), t(12, 40), [C]), ["Làm thêm giờ · đến sớm 40'"]);
  assert.deepEqual(kinds(t(8), t(13, 31), [S]), ["Làm thêm giờ · quá ca 31'"]);
  assert.deepEqual(kinds(t(8), t(13, 20), [S]), []); // quá ca ≤ 30' chưa báo
});

test("Sắp hết ca: còn ≤ 45' và ca sau không có lịch", () => {
  assert.deepEqual(kinds(t(8), t(12, 30), [S]), ["Sắp hết ca · còn 30'"]);
  assert.deepEqual(kinds(t(8), t(12, 10), [S]), []);
  // có lịch làm tiếp ca Chiều → không báo sắp hết ca, báo ở cuối ca Chiều
  assert.deepEqual(kinds(t(8), t(12, 30), [S, C]), []);
  assert.deepEqual(kinds(t(8), t(17, 30), [S, C]), ["Sắp hết ca · còn 30'"]);
  assert.deepEqual(kinds(t(8), t(18, 40), [S, C]), ["Làm thêm giờ · quá ca 40'"]);
});

test("không có ca nào → không badge", () => {
  assert.deepEqual(kinds(t(8), t(9), [], []), []);
});
