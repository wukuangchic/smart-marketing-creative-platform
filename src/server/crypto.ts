import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function masterKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) throw new Error("CREDENTIALS_ENCRYPTION_KEY must be a 32-byte hex value");
  return Buffer.from(raw, "hex");
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string) {
  const [ivPart, tagPart, dataPart] = value.split(".");
  if (!ivPart || !tagPart || !dataPart) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}

export function hashToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
