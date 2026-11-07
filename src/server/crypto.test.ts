import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, hashToken } from "@/server/crypto";

afterEach(() => vi.unstubAllEnvs());

describe("credential encryption", () => {
  it("round-trips a secret with AES-GCM authenticated encryption", () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "0123456789abcdef".repeat(4));
    const ciphertext = encryptSecret("private-api-key-value");
    expect(ciphertext).not.toContain("private-api-key-value");
    expect(decryptSecret(ciphertext)).toBe("private-api-key-value");
  });

  it("rejects tampered ciphertext and hashes session tokens consistently", () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "abcdef0123456789".repeat(4));
    const ciphertext = encryptSecret("secret");
    const [iv, tag, data] = ciphertext.split(".");
    const changed = `${iv}.${tag}.${data.slice(0, -1)}${data.endsWith("A") ? "B" : "A"}`;
    expect(() => decryptSecret(changed)).toThrow();
    expect(hashToken("session-token")).toBe(hashToken("session-token"));
    expect(hashToken("session-token")).not.toBe(hashToken("other-token"));
  });
});
