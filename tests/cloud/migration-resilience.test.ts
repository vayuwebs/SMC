import { afterAll, describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { AppController } from "../../src/server/app-controller.js";
import { PLAIN_BOX } from "../../src/server/cloud/account.js";
import { FakeCloud } from "../../src/server/cloud/fake.js";
import {
  booksFile,
  readManifest,
} from "../../src/server/profiles/data-folder.js";
import { unwrapKeyForSupport } from "../../src/server/vault.js";
import { MIGRATIONS, ManualTimers, cleanUpTemp, setupInput, tempDir } from "./helpers.js";

afterAll(cleanUpTemp);

const PASSWORD = "correct horse 1";

describe("Migration Resilience & Envelope Encryption", () => {
  it("allows existing customer with cached keys to open database and re-sync to new cloud backend", async () => {
    const timers = new ManualTimers();
    const oldCodes: string[] = [];
    const newCodes: string[] = [];

    // 1. Old Cloud Backend (simulate old Supabase project)
    const oldCloud = new FakeCloud({
      dir: tempDir("old-cloud"),
      onCode: (_email, code) => oldCodes.push(code),
      now: timers.clock,
    });

    const userPcDir = tempDir("customer-pc");
    const penDrive = tempDir("pen-drive");

    const appControllerOld = new AppController({
      userDataDir: userPcDir,
      migrationsDir: MIGRATIONS,
      cloud: { backend: oldCloud, info: { kind: "fake", note: null } },
      secretBox: PLAIN_BOX,
      appVersion: "0.2.0",
      platform: "posix",
      roots: () => [penDrive],
      timers,
      now: timers.clock,
    });

    // Sign up on old cloud and create a school
    await appControllerOld.signUp("head@school.in", PASSWORD);
    await appControllerOld.verifySignUp("head@school.in", oldCodes.at(-1)!);

    const created = await appControllerOld.createSchool(penDrive, setupInput());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const oldState = appControllerOld.getAppState();
    expect(oldState.phase).toBe("open");
    if (oldState.phase !== "open") return;

    const profileId = oldState.school.profileId;
    const oldUserId = oldState.user.id;
    const schoolFolder = oldState.school.folder;

    // Verify manifest in school folder
    const manifestOld = readManifest(schoolFolder)!;
    expect(manifestOld.profileId).toBe(profileId);
    expect(manifestOld.ownerUserId).toBe(oldUserId);

    // Close school
    await appControllerOld.closeSchool();

    // 2. New Cloud Backend (simulate switching .env to brand new Supabase project)
    const newCloud = new FakeCloud({
      dir: tempDir("new-cloud"),
      onCode: (_email, code) => newCodes.push(code),
      now: timers.clock,
    });

    // Same customer PC (same userPcDir with existing session/keys.bin), but new backend
    const appControllerNew = new AppController({
      userDataDir: userPcDir,
      migrationsDir: MIGRATIONS,
      cloud: { backend: newCloud, info: { kind: "fake", note: null } },
      secretBox: PLAIN_BOX,
      appVersion: "0.2.0",
      platform: "posix",
      roots: () => [penDrive],
      timers,
      now: timers.clock,
    });

    // Customer logs in on new backend with same email
    // Old session against new cloud fails with session-expired
    const signInResult = await appControllerNew.signUp("head@school.in", PASSWORD);
    expect(signInResult.ok).toBe(true);
    await appControllerNew.verifySignUp("head@school.in", newCodes.at(-1)!);

    const newState = appControllerNew.getAppState();
    expect(newState.phase).toBe("chooseSchool");
    if (newState.phase !== "chooseSchool") return;

    const newUserId = newState.user.id;
    // Verify that the new user ID is different from old user ID
    expect(newUserId).not.toBe(oldUserId);

    // List schools: the school should be visible and ready because the PC has the key
    const schoolList = await appControllerNew.listSchools();
    const foundSchool = schoolList.schools.find((s) => s.profileId === profileId);
    expect(foundSchool).toBeDefined();
    expect(foundSchool?.availability).toBe("ready");

    // Open the school on the new backend
    const openResult = await appControllerNew.openSchool(profileId, { folder: schoolFolder });
    expect(openResult.ok).toBe(true);
    if (!openResult.ok) return;

    // Verify manifest was reconciled to new user ID and upgraded with supportWrappedKey
    const manifestUpgraded = readManifest(schoolFolder)!;
    expect(manifestUpgraded.ownerUserId).toBe(newUserId);
    expect(manifestUpgraded.supportWrappedKey).toBeDefined();

    // Verify supportWrappedKey can be unwrapped with the Developer Support Private Key
    const privateKeyPem = fs.readFileSync(
      path.join(process.cwd(), "developer_support_private_key.pem"),
      "utf8",
    );
    const unwrappedKey = unwrapKeyForSupport(manifestUpgraded.supportWrappedKey!, privateKeyPem);
    expect(unwrappedKey).toBeDefined();
    expect(unwrappedKey.length).toBe(64);

    // Verify that the school was automatically registered in newCloud
    const newCloudProfiles = await appControllerNew["account"]!.withSession((s) => newCloud.listProfiles(s));
    expect(newCloudProfiles.some((p) => p.id === profileId)).toBe(true);

    // Close school to flush backup to new cloud
    await appControllerNew.closeSchool();

    // Verify backup exists in newCloud
    const newCloudBackups = await appControllerNew["account"]!.withSession((s) => newCloud.listBackups(s, profileId));
    expect(newCloudBackups.length).toBeGreaterThan(0);
  });
});
