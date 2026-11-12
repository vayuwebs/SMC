#!/usr/bin/env npx tsx
/**
 * scripts/decrypt-customer-db.ts
 *
 * Developer CLI utility to decrypt an encrypted customer database (books.db)
 * or backup (.smcbak) into a standard, unencrypted SQLite database.
 *
 * Usage:
 *   npx tsx scripts/decrypt-customer-db.ts --input <path> [options]
 *
 * Options:
 *   --input, -i       Path to encrypted books.db or .smcbak file (required)
 *   --output, -o      Output path for the decrypted plain SQLite database
 *                     (default: <input-dirname>/<input-basename>-plain.db)
 *   --key, -k         Direct 64-character hex encryption key
 *   --support-key, -s Path to developer support private key PEM file
 *                     (default: ./developer_support_private_key.pem)
 *   --manifest, -m    Path to customer's profile.json
 *                     (default: checks <input-dirname>/profile.json)
 *   --dump, -d        Path to Supabase dump metadata.json to auto-lookup key
 *   --profile, -p     Profile ID (UUID) to lookup in dump metadata.json
 *   --dise            DISE code to lookup in dump metadata.json
 *   --force, -f       Overwrite output file if it already exists
 */

import Database from "better-sqlite3";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { assertKeyHex, keyFingerprint, unlock, unwrapKeyForSupport } from "../src/server/vault.js";

interface CliOptions {
  input?: string;
  output?: string;
  key?: string;
  supportKeyPath?: string;
  manifestPath?: string;
  dumpPath?: string;
  profileId?: string;
  diseCode?: string;
  force?: boolean;
}

function parseCliArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--input" || arg === "-i") && args[i + 1]) options.input = args[++i];
    else if ((arg === "--output" || arg === "-o") && args[i + 1]) options.output = args[++i];
    else if ((arg === "--key" || arg === "-k") && args[i + 1]) options.key = args[++i];
    else if ((arg === "--support-key" || arg === "-s") && args[i + 1]) options.supportKeyPath = args[++i];
    else if ((arg === "--manifest" || arg === "-m") && args[i + 1]) options.manifestPath = args[++i];
    else if ((arg === "--dump" || arg === "-d") && args[i + 1]) options.dumpPath = args[++i];
    else if ((arg === "--profile" || arg === "-p") && args[i + 1]) options.profileId = args[++i];
    else if (arg === "--dise" && args[i + 1]) options.diseCode = args[++i];
    else if (arg === "--force" || arg === "-f") options.force = true;
  }
  return options;
}

function printUsage() {
  console.log(`
Usage:
  npx tsx scripts/decrypt-customer-db.ts --input <path-to-db> [options]

Examples:
  # Decrypt using a direct 256-bit hex key:
  npx tsx scripts/decrypt-customer-db.ts --input /path/to/books.db --key <64-char-hex>

  # Decrypt using developer support private key (envelope encryption):
  npx tsx scripts/decrypt-customer-db.ts --input /path/to/books.db --support-key developer_support_private_key.pem

  # Decrypt using dumped Supabase metadata to auto-find key by DISE code:
  npx tsx scripts/decrypt-customer-db.ts --input /path/to/books.db --dump supabase-dump/metadata.json --dise 24160201802
`);
}

async function main() {
  const opts = parseCliArgs();

  if (!opts.input) {
    console.error("Error: --input is required.");
    printUsage();
    process.exit(1);
  }

  const inputFile = path.resolve(process.cwd(), opts.input);
  if (!existsSync(inputFile)) {
    console.error(`Error: Input file does not exist: ${inputFile}`);
    process.exit(1);
  }

  const inputDir = path.dirname(inputFile);
  const inputExt = path.extname(inputFile);
  const inputBase = path.basename(inputFile, inputExt);
  const outputFile = opts.output
    ? path.resolve(process.cwd(), opts.output)
    : path.join(inputDir, `${inputBase}-plain.db`);

  if (existsSync(outputFile) && !opts.force) {
    console.error(`Error: Output file already exists: ${outputFile}\nPass --force to overwrite.`);
    process.exit(1);
  }

  console.log("=================================================");
  console.log(" SMC Accounts: Customer Database Decryption Tool");
  console.log("=================================================");
  console.log(`Input File:  ${inputFile} (${statSync(inputFile).size} bytes)`);
  console.log(`Output File: ${outputFile}`);

  // Look for profile.json manifest
  let manifest = null;
  const manifestFile = opts.manifestPath
    ? path.resolve(process.cwd(), opts.manifestPath)
    : path.join(inputDir, "profile.json");

  if (existsSync(manifestFile)) {
    try {
      manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      console.log(`Found Manifest: ${manifestFile}`);
      console.log(`  - School:     ${manifest.schoolNameGu ?? "Unknown"}`);
      console.log(`  - DISE:       ${manifest.diseCode ?? "Unknown"}`);
      console.log(`  - Profile ID: ${manifest.profileId ?? "Unknown"}`);
    } catch {
      // ignore JSON parse error
    }
  }

  let resolvedKeyHex = opts.key?.trim();

  // Strategy 1: Explicit key
  if (resolvedKeyHex) {
    console.log("Using provided direct encryption key...");
    assertKeyHex(resolvedKeyHex);
  }

  // Strategy 2: Support Private Key unwrap (Envelope Encryption)
  if (!resolvedKeyHex) {
    const supportKeyFile = opts.supportKeyPath
      ? path.resolve(process.cwd(), opts.supportKeyPath)
      : path.resolve(process.cwd(), "developer_support_private_key.pem");

    if (manifest?.supportWrappedKey && existsSync(supportKeyFile)) {
      console.log(`Attempting Developer Support Key unwrap using ${supportKeyFile}...`);
      try {
        const privateKeyPem = readFileSync(supportKeyFile, "utf8");
        resolvedKeyHex = unwrapKeyForSupport(manifest.supportWrappedKey, privateKeyPem);
        console.log("Successfully unwrapped DEK via Developer Support Key!");
      } catch (err: unknown) {
        console.warn(`Support key unwrapping failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Strategy 3: Lookup from Supabase dump metadata.json
  if (!resolvedKeyHex && opts.dumpPath) {
    let dumpFile = path.resolve(process.cwd(), opts.dumpPath);
    if (existsSync(dumpFile) && statSync(dumpFile).isDirectory()) {
      dumpFile = path.join(dumpFile, "metadata.json");
    }

    if (existsSync(dumpFile)) {
      console.log(`Looking up key in dump metadata: ${dumpFile}...`);
      try {
        const dump = JSON.parse(readFileSync(dumpFile, "utf8"));
        let targetProfileId = opts.profileId || manifest?.profileId;
        const targetDise = opts.diseCode || manifest?.diseCode;

        // Auto-match if input file is one of the backups in metadata.json
        if (!targetProfileId) {
          const inputBaseName = path.basename(inputFile);
          const matchedBackup = dump.backups?.find((b: { storage_path?: string }) =>
            b.storage_path && path.basename(b.storage_path) === inputBaseName,
          );
          if (matchedBackup?.profile_id) {
            targetProfileId = matchedBackup.profile_id;
            console.log(`Matched backup filename to profile ID: ${targetProfileId}`);
          }
        }

        let matchedProfile = null;
        if (targetProfileId && dump.profiles) {
          matchedProfile = dump.profiles.find((p: { id: string }) => p.id === targetProfileId);
        }
        if (!matchedProfile && targetDise && dump.profiles) {
          matchedProfile = dump.profiles.find((p: { dise_code: string }) => p.dise_code === targetDise);
        }

        // If still not resolved and dump contains exactly one profile/key, use it
        if (!targetProfileId && !matchedProfile && dump.profileKeys?.length === 1) {
          targetProfileId = dump.profileKeys[0].profile_id;
          matchedProfile = dump.profiles?.find((p: { id: string }) => p.id === targetProfileId);
          console.log(`Auto-selected sole profile in dump: ${matchedProfile?.school_name_gu ?? targetProfileId}`);
        }

        const profileId = matchedProfile?.id || targetProfileId;
        if (profileId && dump.profileKeys) {
          const keyRecord = dump.profileKeys.find((k: { profile_id: string }) => k.profile_id === profileId);
          if (keyRecord?.key_hex) {
            resolvedKeyHex = keyRecord.key_hex;
            console.log(`Found matching key in dump for profile ${profileId}!`);
            if (matchedProfile) {
              console.log(`  - School: [${matchedProfile.dise_code}] ${matchedProfile.school_name_gu}`);
            }
          }
        }
      } catch (e: unknown) {
        console.warn(`Could not read dump file: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (!resolvedKeyHex) {
    console.error("\nError: Could not resolve encryption key.");
    console.error("Please supply one of:");
    console.error("  --key <64-char-hex>");
    console.error("  --support-key <developer_support_private_key.pem> (if profile.json has supportWrappedKey)");
    console.error("  --dump <metadata.json> [--dise <code-or-name>]");
    process.exit(1);
  }

  assertKeyHex(resolvedKeyHex);

  // If manifest is available, verify key fingerprint
  if (manifest?.profileId && manifest?.keyFingerprint) {
    const fp = keyFingerprint(resolvedKeyHex, manifest.profileId);
    if (fp !== manifest.keyFingerprint) {
      console.warn("\nWARNING: Key fingerprint does not match profile.json! The key might be wrong.");
    } else {
      console.log("Key fingerprint verified against manifest (matches).");
    }
  }

  console.log("\nDecrypting database...");

  // Copy to output destination first, then decrypt in place
  rmSync(outputFile, { force: true });
  copyFileSync(inputFile, outputFile);

  let db: Database.Database | null = null;
  try {
    db = new Database(outputFile);
    unlock(db, resolvedKeyHex);

    // Switch off WAL journal mode for clean decryption
    db.pragma("journal_mode = DELETE");

    // Rekey to empty string decrypts all pages to standard plain SQLite
    db.pragma("hexrekey = ''");

    // Verify decryption by reading schema
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const rowCounts: Record<string, number> = {};
    for (const t of tables) {
      try {
        const res = db.prepare(`SELECT count(*) as count FROM "${t.name}"`).get() as { count: number };
        rowCounts[t.name] = res.count;
      } catch {
        // ignore
      }
    }

    db.close();
    db = null;

    // Verify reopening without ANY key as a standard SQLite file
    const plainDb = new Database(outputFile, { readonly: true });
    const countCheck = plainDb.prepare("SELECT count(*) as count FROM sqlite_master").get() as { count: number };
    plainDb.close();

    console.log("\n=================================================");
    console.log(" DECRYPTION SUCCESSFUL!");
    console.log("=================================================");
    console.log(`Plain SQLite database created at: ${outputFile}`);
    console.log(`Objects in schema: ${countCheck.count}`);
    console.log("Tables and row counts:");
    for (const [tbl, cnt] of Object.entries(rowCounts)) {
      console.log(`  - ${tbl}: ${cnt} rows`);
    }
    console.log("=================================================\n");
  } catch (err: unknown) {
    if (db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
    rmSync(outputFile, { force: true });
    console.error("\nDecryption failed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
