/**
 * Encryption of a school's database on disk - this project's TallyVault.
 *
 * Each school's books are one SQLite file, usually on a pen drive. A pen drive
 * gets lost, so the file is encrypted: every page is sealed with ChaCha20-
 * Poly1305 by SQLite3 Multiple Ciphers (the `better-sqlite3` package here is an
 * npm alias for better-sqlite3-multiple-ciphers). Without the key the file is
 * noise - even the "SQLite format 3" header is gone - and Poly1305 means a
 * tampered page is refused rather than read.
 *
 * The key is 32 random bytes per school, never typed by anyone and never written
 * to the pen drive. It is held by the school's account in the cloud and cached
 * on each PC that has opened the school, encrypted by the operating system
 * (see src/server/cloud/account.ts). So a finder of the pen drive has nothing,
 * while the owner can open it on any PC they log in on.
 *
 * Everything that opens a school database goes through `unlock`, so the cipher
 * settings live in exactly one place.
 */
import Database from "better-sqlite3";
import { constants, createHmac, privateDecrypt, publicEncrypt, randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";

/** The cipher scheme. Recorded in each profile's manifest for the future. */
export const CIPHER = "chacha20";

/**
 * Developer Support Public Key (RSA-4096).
 * Used for envelope encryption so that any customer database/backup shared with support
 * can be decrypted offline using the corresponding Developer Support Private Key.
 */
export const DEFAULT_SUPPORT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA38UtRkxKyfDV1s6Oy251
DSXhsL01mIflgz540Qty0CMeME82EFeocpX8lPUJhkQaZ0k6pXfujK3mcn7MLalE
UhDMfIiioUoF6iLC6LgZWHxQbWgjutrQOZv8U+SWYYdxGfFdylozS4qIYelqZP+I
+rDLgVqX6OaQSCGS0CrbX7wwf95dFzjhr07qSWVpNGUe4GO+uR8t0s5w/EGQ2+Sz
WqUfxM15J6N6kTW5RYkEoK8OAjlV/ymThG2aZi8lseDXKvhv4phSkThZ9H6mI/eL
4xMfrAqwFOTOH35HWKPndyvVUjYcuqDGswjAs8IjbgtlMPxyoa4dFRWYO8B2hQhd
/Y2sQdFTPNKMUuCRhFXMpZXQcR3lC/hGHveK/9PaVkNj6plltjkGtF5vEBfHhkd9
q3ucTWaEByql3wIg8IZlN08ulfxDp7CXF2EKVFQicYLnHwx3itFuvCv1xEkkJxRy
F7DcMeMxjWI/Wn7Tiwlo2url+vStvlSh9P5Jy+ia1+twIgq8RHRbeu1j8L+dNsHG
9uuEUiC9hOenP52fHShaS72JEK+caexV9Ugp0DJez40y35zStZvELY53HTy4VOjs
/XLWdMAByu2G2m7/WQCdCTl+6R9iSAGvtP3fMmxJ5pfncLTeMgNsqlujXFzHjJLB
HPweirQqSiFzBn3ewRVmDHECAwEAAQ==
-----END PUBLIC KEY-----`;

/**
 * Wrap the 256-bit database encryption key (DEK) with the Developer Support Public Key.
 * Returns Base64-encoded ciphertext.
 */
export function wrapKeyForSupport(
  keyHex: string,
  publicKeyPem: string = DEFAULT_SUPPORT_PUBLIC_KEY,
): string {
  assertKeyHex(keyHex);
  const encrypted = publicEncrypt(
    {
      key: publicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    Buffer.from(keyHex, "hex"),
  );
  return encrypted.toString("base64");
}

/**
 * Unwrap a Base64-encoded Support-wrapped key using the Developer Support Private Key.
 * Returns the original 64-character lowercase hex key.
 */
export function unwrapKeyForSupport(
  wrappedBase64: string,
  privateKeyPem: string,
): string {
  try {
    const decrypted = privateDecrypt(
      {
        key: privateKeyPem,
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(wrappedBase64, "base64"),
    );
    const keyHex = decrypted.toString("hex");
    assertKeyHex(keyHex);
    return keyHex;
  } catch (error) {
    if (error instanceof VaultError) throw error;
    throw new VaultError(
      "bad-key",
      `Failed to unwrap support key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const KEY_PATTERN = /^[0-9a-f]{64}$/;

export class VaultError extends Error {
  constructor(
    readonly code: "wrong-key" | "not-a-database" | "bad-key",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

/** A new random key for a new school, as 64 lowercase hex characters. */
export function generateKeyHex(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Refuse anything that is not exactly a 256-bit hex key.
 *
 * The key reaches SQLite through a PRAGMA, which cannot take a bound
 * parameter; this check is what makes interpolating it safe.
 */
export function assertKeyHex(keyHex: string): void {
  if (!KEY_PATTERN.test(keyHex)) throw new VaultError("bad-key", "not a 256-bit hex key");
}

/**
 * A short fingerprint of the key, stored in the profile's manifest.
 *
 * It lets the app tell "this is the wrong key" apart from "this file is
 * damaged" without guessing, and check a cached key before trusting it. It is
 * an HMAC, so it reveals nothing about the key.
 */
export function keyFingerprint(keyHex: string, profileId: string): string {
  assertKeyHex(keyHex);
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(`smc-accounts-profile:${profileId}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Give an open connection its key. Must be the first thing done with it:
 * SQLite reads nothing from the file until the first statement, so no page is
 * ever read without the key.
 */
export function unlock(database: Database.Database, keyHex: string): void {
  assertKeyHex(keyHex);
  database.pragma(`cipher = '${CIPHER}'`);
  database.pragma(`hexkey = '${keyHex}'`);
}

/**
 * Open an encrypted database and prove the key is right.
 *
 * A wrong key does not fail at open, only at the first read, so this reads the
 * schema immediately and turns the failure into a VaultError.
 */
export function openEncrypted(
  file: string,
  keyHex: string,
  options?: Database.Options,
): Database.Database {
  const database = new Database(file, options);
  try {
    unlock(database, keyHex);
    database.prepare("SELECT count(*) FROM sqlite_master").get();
    return database;
  } catch (error) {
    database.close();
    if (error instanceof VaultError) throw error;
    if (isNotADatabase(error)) {
      throw new VaultError("wrong-key", `cannot read ${file}: wrong key, or not an SMC database`);
    }
    throw error;
  }
}

/**
 * A consistent, still-encrypted copy of an open database.
 *
 * VACUUM INTO runs inside a read transaction, so the copy is never half a write,
 * and SQLite3 Multiple Ciphers encrypts the copy with the source's cipher and
 * key. Used for the local rolling backups and the cloud backups alike.
 */
export function snapshotInto(file: string, keyHex: string, destination: string): void {
  rmSync(destination, { force: true });
  const database = openEncrypted(file, keyHex, { fileMustExist: true });
  try {
    database.exec(`VACUUM INTO ${sqlString(destination)}`);
  } finally {
    database.close();
  }
}

/**
 * Make an encrypted copy of an unencrypted database.
 *
 * Used once, to bring the books from before profiles existed into a profile.
 * The source is never modified. The copy is compacted first, switched off WAL
 * (the cipher cannot re-key a WAL database), then encrypted in place.
 */
export function encryptCopy(plainFile: string, destination: string, keyHex: string): void {
  assertKeyHex(keyHex);
  if (!existsSync(plainFile)) throw new Error(`${plainFile} does not exist`);
  rmSync(destination, { force: true });

  const source = new Database(plainFile, { fileMustExist: true });
  try {
    source.exec(`VACUUM INTO ${sqlString(destination)}`);
  } finally {
    source.close();
  }

  const copy = new Database(destination, { fileMustExist: true });
  try {
    copy.pragma("journal_mode = DELETE");
    copy.pragma(`cipher = '${CIPHER}'`);
    copy.pragma(`hexrekey = '${keyHex}'`);
  } finally {
    copy.close();
  }

  // Prove the result opens with the key before anyone relies on it.
  openEncrypted(destination, keyHex, { fileMustExist: true }).close();
}

/** True when a file exists and is readable WITHOUT a key - i.e. unencrypted. */
export function isPlainDatabase(file: string): boolean {
  if (!existsSync(file)) return false;
  try {
    const database = new Database(file, { readonly: true, fileMustExist: true });
    try {
      database.prepare("SELECT count(*) FROM sqlite_master").get();
      return true;
    } finally {
      database.close();
    }
  } catch {
    return false;
  }
}

function isNotADatabase(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT";
}

/** A SQL string literal. Paths can contain quotes; VACUUM INTO cannot bind. */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
