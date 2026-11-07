import { test } from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { normalizePrivateKey, serviceAccount } from "../src/lib/sheets";

const pem = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const ok = (k: string) => assert.doesNotThrow(() => createPrivateKey(normalizePrivateKey(k)));

test("private key: các kiểu dán hay gặp đều đọc được", () => {
  ok(pem); // chuẩn
  ok(pem.replace(/\n/g, "\\n")); // "\n" dạng chữ (như trong file JSON)
  ok(`"${pem.replace(/\n/g, "\\n")}"`); // còn dấu " bao quanh
  ok(pem.replace(/\n/g, "\r\n")); // xuống dòng Windows
  ok(pem.replace(/\n/g, " ")); // dán thành 1 dòng, dấu cách thay xuống dòng
  ok(Buffer.from(pem).toString("base64")); // base64
});

test("GOOGLE_SA_JSON: dán nguyên file JSON", () => {
  process.env.GOOGLE_SA_JSON = JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: pem });
  const sa = serviceAccount();
  assert.equal(sa?.email, "x@y.iam.gserviceaccount.com");
  assert.doesNotThrow(() => createPrivateKey(sa!.key));
  delete process.env.GOOGLE_SA_JSON;
});
