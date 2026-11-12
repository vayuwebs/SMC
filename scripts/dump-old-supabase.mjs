#!/usr/bin/env node
/**
 * scripts/dump-old-supabase.mjs
 *
 * Connects to the Supabase instance configured in .env and exports:
 *  - User account info
 *  - Approval status (account_access)
 *  - School profiles (public.profiles)
 *  - School encryption keys (public.profile_keys)
 *  - Cloud backup metadata (public.backups)
 *  - Encrypted backup binaries (.smcbak files downloaded from the "backups" storage bucket)
 *
 * Usage:
 *   node scripts/dump-old-supabase.mjs [--email <email>] [--password <password>] [--service-role-key <key>]
 *
 * If credentials are not provided via CLI flags, it prompts interactively.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = path.resolve(import.meta.dirname, "..");

function readEnv() {
  const values = { ...process.env };
  const envFile = path.join(ROOT, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && values[match[1]] === undefined) {
        values[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
      }
    }
  }
  return values;
}

function prompt(question, hideText = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hideText && process.stdin.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const oldRaw = stdin.isRaw;
      stdin.setRawMode(true);
      stdin.resume();
      let input = "";
      const onData = (char) => {
        const c = char.toString();
        if (c === "\n" || c === "\r" || c === "\u0004") {
          stdin.setRawMode(oldRaw);
          stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          resolve(input);
        } else if (c === "\u0003") {
          process.exit(1);
        } else if (c === "\b" || c === "\x7f") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else {
          input += c;
          process.stdout.write("*");
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--email" && args[i + 1]) result.email = args[++i];
    else if (args[i] === "--password" && args[i + 1]) result.password = args[++i];
    else if (args[i] === "--service-role-key" && args[i + 1]) result.serviceRoleKey = args[++i];
    else if (args[i] === "--out" && args[i + 1]) result.outDir = args[++i];
  }
  return result;
}

async function main() {
  console.log("=================================================");
  console.log(" SMC Accounts: Supabase Backend Exporter / Dump");
  console.log("=================================================\n");

  const env = readEnv();
  const url = (env.MAIN_VITE_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  const publishableKey = (env.MAIN_VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
  const cliArgs = parseArgs();

  if (!url || !publishableKey) {
    console.error("Error: MAIN_VITE_SUPABASE_URL and MAIN_VITE_SUPABASE_PUBLISHABLE_KEY must be in .env");
    process.exit(1);
  }

  console.log(`Connecting to: ${url}`);

  const serviceRoleKey = cliArgs.serviceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
  let client;
  let session = null;
  let user = null;
  const isServiceRole = Boolean(serviceRoleKey);

  if (isServiceRole) {
    console.log("Using provided SERVICE_ROLE key (admin bypass)...");
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let email = cliArgs.email;
    let password = cliArgs.password;

    if (!email) {
      email = await prompt("Enter user email: ");
    }
    if (!password) {
      password = await prompt("Enter user password: ", true);
    }

    if (!email || !password) {
      console.error("Error: email and password are required when no service-role key is provided.");
      process.exit(1);
    }

    console.log(`Signing in as ${email}...`);
    const { data: authData, error: authError } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session) {
      console.error("Authentication failed:", authError?.message || "No session returned");
      process.exit(1);
    }

    session = authData.session;
    user = authData.user;
    console.log(`Successfully authenticated! User ID: ${user.id}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultDirName = `supabase-dump-${timestamp}`;
  const outDir = path.resolve(process.cwd(), cliArgs.outDir || defaultDirName);
  const backupsStorageDir = path.join(outDir, "backups");
  mkdirSync(backupsStorageDir, { recursive: true });

  const dump = {
    dumpDate: new Date().toISOString(),
    supabaseUrl: url,
    mode: isServiceRole ? "service_role" : "user_authenticated",
    user: user
      ? { id: user.id, email: user.email, createdAt: user.created_at }
      : null,
    accountAccess: [],
    users: [],
    profiles: [],
    profileKeys: [],
    backups: [],
    downloadedFiles: [],
  };

  // 1. If service role, fetch all auth users
  if (isServiceRole && client.auth.admin) {
    console.log("\n[1/5] Exporting auth users...");
    const { data: userData, error: userError } = await client.auth.admin.listUsers();
    if (!userError && userData?.users) {
      dump.users = userData.users;
      console.log(`  -> Found ${dump.users.length} users`);
    } else {
      console.warn("  -> Could not list admin users:", userError?.message);
    }
  }

  // 2. Fetch account_access
  console.log("\n[2/5] Exporting account_access...");
  try {
    const { data: accessData, error: accessError } = await client
      .from("account_access")
      .select("*");
    if (!accessError && accessData) {
      dump.accountAccess = accessData;
      console.log(`  -> Found ${accessData.length} account_access record(s)`);
    } else {
      console.warn("  -> Note on account_access:", accessError?.message || "none");
    }
  } catch (e) {
    console.warn("  -> account_access query error:", e.message);
  }

  // 3. Fetch profiles
  console.log("\n[3/5] Exporting profiles...");
  const { data: profiles, error: profilesError } = await client
    .from("profiles")
    .select("*");
  if (profilesError) {
    console.error("  -> Error fetching profiles:", profilesError.message);
  } else {
    dump.profiles = profiles || [];
    console.log(`  -> Found ${dump.profiles.length} profile(s):`);
    for (const p of dump.profiles) {
      console.log(`     - [${p.dise_code}] ${p.school_name_gu} (ID: ${p.id})`);
    }
  }

  // 4. Fetch profile_keys
  console.log("\n[4/5] Exporting profile_keys (encryption keys)...");
  const { data: keys, error: keysError } = await client
    .from("profile_keys")
    .select("*");
  if (keysError) {
    console.error("  -> Error fetching profile_keys:", keysError.message);
  } else {
    dump.profileKeys = keys || [];
    console.log(`  -> Found ${dump.profileKeys.length} encryption key(s):`);
    for (const k of dump.profileKeys) {
      console.log(`     - Profile: ${k.profile_id} -> Key: ${k.key_hex}`);
    }
  }

  // 5. Fetch backups and download binaries
  console.log("\n[5/5] Exporting cloud backups metadata and files...");
  const { data: backups, error: backupsError } = await client
    .from("backups")
    .select("*");
  if (backupsError) {
    console.error("  -> Error fetching backups:", backupsError.message);
  } else {
    dump.backups = backups || [];
    console.log(`  -> Found ${dump.backups.length} backup record(s). Downloading binaries...`);

    for (let i = 0; i < dump.backups.length; i++) {
      const b = dump.backups[i];
      console.log(`     [${i + 1}/${dump.backups.length}] Downloading ${b.storage_path}...`);
      try {
        const { data: fileData, error: downloadError } = await client.storage
          .from("backups")
          .download(b.storage_path);

        if (downloadError || !fileData) {
          console.warn(`       -> Download failed: ${downloadError?.message}`);
        } else {
          const buffer = Buffer.from(await fileData.arrayBuffer());
          const targetLocalPath = path.join(backupsStorageDir, path.basename(b.storage_path));
          writeFileSync(targetLocalPath, buffer);
          dump.downloadedFiles.push({
            storagePath: b.storage_path,
            localPath: path.relative(outDir, targetLocalPath),
            sizeBytes: buffer.length,
            sha256: b.sha256,
          });
          console.log(`       -> Saved to ${path.relative(process.cwd(), targetLocalPath)} (${buffer.length} bytes)`);
        }
      } catch (err) {
        console.warn(`       -> Error downloading ${b.storage_path}:`, err.message);
      }
    }
  }

  // Save metadata json
  const metadataPath = path.join(outDir, "metadata.json");
  writeFileSync(metadataPath, JSON.stringify(dump, null, 2), "utf8");

  console.log("\n=================================================");
  console.log(" DUMP COMPLETED SUCCESSFULLY!");
  console.log("=================================================");
  console.log(`Output Directory: ${outDir}`);
  console.log(`Metadata file:    ${metadataPath}`);
  console.log(`Profiles:         ${dump.profiles.length}`);
  console.log(`Keys:             ${dump.profileKeys.length}`);
  console.log(`Backups metadata: ${dump.backups.length}`);
  console.log(`Files downloaded: ${dump.downloadedFiles.length}`);
  console.log("=================================================\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
