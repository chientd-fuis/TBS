import crypto from "node:crypto";

function key() {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) throw new Error("ENCRYPTION_KEY phải là 64 ký tự hex (32 byte)");
  return Buffer.from(hex, "hex");
}

/** Mã hoá AES-256-GCM → "iv.tag.data" (base64). */
export function encrypt(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map((b) => b.toString("base64")).join(".");
}

export function decrypt(enc: string | undefined | null): string {
  if (!enc) return "";
  try {
    const [iv, tag, data] = enc.split(".").map((s) => Buffer.from(s, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
