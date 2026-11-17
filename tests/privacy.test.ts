import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdown } from "../src/components/Markdown";
import { needsPrivacyConsent, PRIVACY_TEMPLATE } from "../src/lib/privacy";

test("parseMarkdown: tiêu đề, danh sách, bảng, ghi chú, đoạn", () => {
  const b = parseMarkdown("# A\n\n> **x**\n> y\n\n- a\n- b\n\n1. c\n2. d\n\n| H1 | H2 |\n|---|---|\n| 1 | 2 |\n\ndòng 1\ndòng 2\n\n---\n<script>alert(1)</script>");
  assert.deepEqual(b.map((x) => x.k), ["h", "quote", "ul", "ol", "table", "p", "hr", "p"]);
  assert.deepEqual((b[4] as { rows: string[][] }).rows, [["H1", "H2"], ["1", "2"]]);
  assert.deepEqual((b[5] as { lines: string[] }).lines, ["dòng 1", "dòng 2"]);
});

test("mẫu chính sách đọc được đủ 7 mục", () => {
  const h = parseMarkdown(PRIVACY_TEMPLATE).filter((x) => x.k === "h");
  assert.equal(h.length, 8); // tiêu đề + 7 mục
});

test("needsPrivacyConsent", () => {
  assert.equal(needsPrivacyConsent({ privacyVersion: 0 }, { privacyVersion: 0 }), false);
  assert.equal(needsPrivacyConsent({ privacyVersion: 1 }, {}), true);
  assert.equal(needsPrivacyConsent({ privacyVersion: 2 }, { privacyVersion: 1 }), true);
  assert.equal(needsPrivacyConsent({ privacyVersion: 2 }, { privacyVersion: 2 }), false);
});
