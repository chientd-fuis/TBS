import { test } from "node:test";
import assert from "node:assert/strict";
import { boldParts, parseRules, RULES_TEMPLATE } from "../src/lib/rules-format";
import { mergeAiConfig } from "../src/lib/ai";

test("nội quy: tiêu đề, điều mục đánh số (kèm ý nhỏ), lưu ý, chữ đậm", () => {
  const b = parseRules("# NỘI QUY\n! Lưu ý\n1. **Đúng giờ:** đến sớm 5 phút\n- Đi muộn phạt 20.000\nchấm công khi đến\n2) Đồng phục\n- thuộc điều 2");
  assert.deepEqual(b.map((x) => x.kind), ["heading", "note", "item", "item"]);
  assert.deepEqual(parseRules("Đoạn thường\n- ý lẻ").map((x) => x.kind), ["para", "bullet"]);
  assert.deepEqual(b[2], { kind: "item", no: "1", text: "**Đúng giờ:** đến sớm 5 phút", sub: ["Đi muộn phạt 20.000", "chấm công khi đến"] });
  assert.deepEqual(boldParts("**Đúng giờ:** đến sớm"), [["Đúng giờ:", true], [" đến sớm", false]]);
});

test("mẫu 10 điều; nội quy trống → dùng mẫu", () => {
  assert.equal(parseRules(RULES_TEMPLATE).filter((x) => x.kind === "item").length, 10);
  assert.equal(mergeAiConfig({ assistant: { rules: "  " } }).assistant.rules, RULES_TEMPLATE);
  assert.equal(mergeAiConfig({ assistant: { rules: "1. Riêng quán" } }).assistant.rules, "1. Riêng quán");
});
