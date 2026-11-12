import { describe, expect, it } from "vitest";
import {
  generateKeyHex,
  wrapKeyForSupport,
  unwrapKeyForSupport,
  DEFAULT_SUPPORT_PUBLIC_KEY,
  VaultError,
} from "../src/server/vault.js";
import fs from "node:fs";
import path from "node:path";

describe("Developer Support Envelope Encryption", () => {
  const privateKeyPem = fs.readFileSync(
    path.join(process.cwd(), "developer_support_private_key.pem"),
    "utf8",
  );

  it("wraps and unwraps a 256-bit database key using the Developer Support Keypair", () => {
    const originalKey = generateKeyHex();
    const wrapped = wrapKeyForSupport(originalKey, DEFAULT_SUPPORT_PUBLIC_KEY);

    expect(typeof wrapped).toBe("string");
    expect(wrapped.length).toBeGreaterThan(100);

    const unwrapped = unwrapKeyForSupport(wrapped, privateKeyPem);
    expect(unwrapped).toBe(originalKey);
  });

  it("fails cleanly when unwrapping tampered or invalid ciphertext", () => {
    const tampered = Buffer.from("invalid-ciphertext-data-not-a-valid-envelope").toString("base64");
    expect(() => unwrapKeyForSupport(tampered, privateKeyPem)).toThrow(VaultError);
  });

  it("decrypts an encrypted database using decrypt-customer-db.ts and support key", async () => {
    const { execSync } = await import("node:child_process");
    const Database = (await import("better-sqlite3")).default;
    const tmpDir = path.join(process.cwd(), ".scratch", "test-decrypt-" + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    const keyHex = generateKeyHex();
    const encDbPath = path.join(tmpDir, "books.db");
    const plainDbPath = path.join(tmpDir, "books-decrypted.db");

    // 1. Create encrypted test DB
    const db = new Database(encDbPath);
    const { unlock } = await import("../src/server/vault.js");
    unlock(db, keyHex);
    db.exec("CREATE TABLE test_data (id INT, note TEXT); INSERT INTO test_data VALUES (123, 'confidential');");
    db.close();

    // 2. Create profile.json with supportWrappedKey
    const wrapped = wrapKeyForSupport(keyHex, DEFAULT_SUPPORT_PUBLIC_KEY);
    fs.writeFileSync(
      path.join(tmpDir, "profile.json"),
      JSON.stringify({
        format: "smc-accounts-profile",
        formatVersion: 2,
        profileId: "00000000-0000-4000-8000-000000000001",
        ownerUserId: "test-user",
        schoolNameGu: "ટેસ્ટ શાળા",
        diseCode: "12345678901",
        cipher: "chacha20",
        keyFingerprint: "unused-for-this-test",
        supportWrappedKey: wrapped,
        createdAt: new Date().toISOString(),
      }),
    );

    // 3. Run decrypt CLI
    const scriptPath = path.join(process.cwd(), "scripts", "decrypt-customer-db.ts");
    const cmd = `npx tsx "${scriptPath}" --input "${encDbPath}" --output "${plainDbPath}" --support-key "${path.join(process.cwd(), "developer_support_private_key.pem")}"`;
    execSync(cmd, { stdio: "pipe" });

    expect(fs.existsSync(plainDbPath)).toBe(true);

    // 4. Verify standard SQLite can read it without any key
    const plainDb = new Database(plainDbPath, { readonly: true });
    const row = plainDb.prepare("SELECT * FROM test_data").get() as { id: number; note: string };
    expect(row).toEqual({ id: 123, note: "confidential" });
    plainDb.close();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
