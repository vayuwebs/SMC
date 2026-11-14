/**
 * Managing whole schools from the school list and Settings:
 *
 *   deleting a school - password first, then the cloud, then its folder;
 *   one report's layout applied to every other school of the account;
 *   renaming the data folder, and finding it again under its new name.
 */
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { AppController } from "../../src/server/app-controller.js";
import { PLAIN_BOX } from "../../src/server/cloud/account.js";
import { FakeCloud } from "../../src/server/cloud/fake.js";
import {
  DATA_DIR_MARKER,
  DATA_DIR_NAME,
  findProfilesIn,
  readSyncState,
} from "../../src/server/profiles/data-folder.js";
import { emptyLayout } from "../../src/shared/report-layout.js";
import { MIGRATIONS, ManualTimers, cleanUpTemp, setupInput, tempDir } from "./helpers.js";

// Every controller let go of its books first: Windows will not delete an open file.
const controllers: AppController[] = [];
afterAll(async () => {
  for (const controller of controllers) await controller.closeSchool(0);
  cleanUpTemp();
});

/** "Pull the pen drive out": its folder is no longer where it was. */
function pullOut(drive: string): void {
  renameSync(drive, `${drive}-out`);
}

const PASSWORD = "correct horse 1";
const EMAIL = "head@school.in";

function world() {
  const timers = new ManualTimers();
  const codes: string[] = [];
  let offline = false;
  const cloud = new FakeCloud({
    dir: tempDir("cloud"),
    onCode: (_email, code) => codes.push(code),
    isOffline: () => offline,
    now: timers.clock,
  });
  let drives: string[] = [];
  const pc = () => {
    const controller = new AppController({
      userDataDir: tempDir("pc"),
      migrationsDir: MIGRATIONS,
      cloud: { backend: cloud, info: { kind: "fake", note: null } },
      secretBox: PLAIN_BOX,
      appVersion: "0.3.1",
      platform: "posix",
      roots: () => drives,
      timers,
      now: timers.clock,
    });
    controllers.push(controller);
    return controller;
  };
  return {
    cloud,
    pc,
    setOffline: (value: boolean) => (offline = value),
    plugIn: (...roots: string[]) => (drives = roots),
    lastCode: () => codes.at(-1)!,
  };
}

async function signedIn(w: ReturnType<typeof world>): Promise<AppController> {
  const controller = w.pc();
  await controller.signUp(EMAIL, PASSWORD);
  const verified = await controller.verifySignUp(EMAIL, w.lastCode());
  if (!verified.ok) throw new Error(JSON.stringify(verified.issues));
  return controller;
}

async function createSchool(controller: AppController, at: string, diseCode: string, nameGu = `શાળા ${diseCode}`) {
  const created = await controller.createSchool(at, setupInput({ diseCode, nameGu }));
  if (!created.ok || created.data.phase !== "open") throw new Error(JSON.stringify(created));
  return created.data.school;
}

describe("deleting a whole school", () => {
  it("asks for the account password, then removes it from the cloud and from the pen drive", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const school = await createSchool(pc1, penDrive, "24160200001");
    const other = await createSchool(pc1, penDrive, "24160200002");

    expect((await pc1.deleteSchool(school.profileId, "")).ok).toBe(false);
    const wrong = await pc1.deleteSchool(school.profileId, "not the password");
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.issues[0]?.code).toBe("invalid_credentials");
    expect(existsSync(school.folder)).toBe(true);

    // The second school is the open one; delete the first, which is closed.
    const deleted = await pc1.deleteSchool(school.profileId, PASSWORD);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data.folderRemoved).toBe(school.folder);
    expect(existsSync(school.folder)).toBe(false);
    expect(deleted.data.list.schools.map((item) => item.profileId)).toEqual([other.profileId]);
    // The data folder still holds the other school.
    expect(existsSync(other.folder)).toBe(true);

    // A second PC on the same account does not see it either.
    const pc2 = w.pc();
    await pc2.signIn(EMAIL, PASSWORD);
    expect((await pc2.listSchools()).schools.map((item) => item.profileId)).toEqual([other.profileId]);
  });

  it("closes the open school first, and removes the data folder once it is empty", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const school = await createSchool(pc1, penDrive, "24160200003");
    expect(pc1.getAppState().phase).toBe("open");

    const deleted = await pc1.deleteSchool(school.profileId, PASSWORD);
    expect(deleted.ok).toBe(true);
    expect(pc1.getAppState().phase).toBe("chooseSchool");
    expect(existsSync(path.join(penDrive, DATA_DIR_NAME))).toBe(false);
  });

  it("deletes nothing without the internet", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const school = await createSchool(pc1, penDrive, "24160200004");
    await pc1.closeSchool(0);

    w.setOffline(true);
    expect((await pc1.deleteSchool(school.profileId, PASSWORD)).ok).toBe(false);
    w.setOffline(false);
    expect(existsSync(school.folder)).toBe(true);
    expect((await pc1.listSchools()).schools).toHaveLength(1);
  });

  it("still takes it out of the account when its pen drive is not plugged in", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const school = await createSchool(pc1, penDrive, "24160200005");
    await pc1.closeSchool(0);
    pullOut(penDrive);
    w.plugIn();

    const deleted = await pc1.deleteSchool(school.profileId, PASSWORD);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data.folderRemoved).toBeNull();
    expect(deleted.data.list.schools).toEqual([]);
  });

  it("lets the same DISE code be created again afterwards", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const school = await createSchool(pc1, penDrive, "24160200006");
    await pc1.deleteSchool(school.profileId, PASSWORD);
    await expect(createSchool(pc1, penDrive, "24160200006")).resolves.toBeDefined();
  });
});

describe("one report's layout for every school", () => {
  it("copies the open school's saved layout of that report only, and says which schools it missed", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    const elsewhere = tempDir("other-drive");
    w.plugIn(penDrive, elsewhere);
    const pc1 = await signedIn(w);
    const second = await createSchool(pc1, penDrive, "24160200011", "બીજી શાળા");
    const third = await createSchool(pc1, elsewhere, "24160200012", "ત્રીજી શાળા");
    const first = await createSchool(pc1, penDrive, "24160200010", "પહેલી શાળા");

    const rojmel = { ...emptyLayout(), sizePt: 11, widths: { date: 12 } };
    const saved = await pc1.books!.saveReportLayout("rojmel", rojmel);
    expect(saved.ok).toBe(true);
    await pc1.books!.saveReportLayout("billRegister", { ...emptyLayout(), sizePt: 9 });

    // The third school's drive is pulled out before applying.
    pullOut(elsewhere);
    w.plugIn(penDrive);
    const result = await pc1.applyLayoutToAllSchools("rojmel");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.applied).toEqual(["બીજી શાળા"]);
    expect(result.data.skipped).toEqual([
      { profileId: third.profileId, schoolNameGu: "ત્રીજી શાળા", reason: "notConnected" },
    ]);
    // It owes a cloud backup now, like any other change to its books.
    expect(readSyncState(second.folder).pendingSince).not.toBeNull();

    const opened = await pc1.openSchool(second.profileId);
    expect(opened.ok).toBe(true);
    expect(await pc1.books!.getReportLayout("rojmel")).toMatchObject({ sizePt: 11, widths: { date: 12 } });
    // Only the report that was open: the bill register keeps its own (default) layout.
    expect((await pc1.books!.getReportLayout("billRegister")).sizePt).toBeUndefined();
    expect(first.profileId).not.toBe(second.profileId);
  });

  it("leaves out a school another PC has open", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const busy = await createSchool(pc1, penDrive, "24160200021", "ખુલ્લી શાળા");
    await pc1.closeSchool(0);
    await createSchool(pc1, penDrive, "24160200020");

    const pc2 = w.pc();
    await pc2.signIn(EMAIL, PASSWORD);
    expect((await pc2.openSchool(busy.profileId)).ok).toBe(true);

    const result = await pc1.applyLayoutToAllSchools("rojmel");
    expect(result.ok && result.data.skipped.map((skip) => skip.reason)).toEqual(["openElsewhere"]);
  });
});

describe("renaming the data folder", () => {
  it("renames it with every school inside, keeps the books open, and finds it again by its new name", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    const other = await createSchool(pc1, penDrive, "24160200031");
    const school = await createSchool(pc1, penDrive, "24160200030");

    const renamed = await pc1.renameDataFolder("Shala Hisab 2026");
    expect(renamed.ok).toBe(true);
    if (!renamed.ok || renamed.data.phase !== "open") return;
    const newDir = path.join(penDrive, "Shala Hisab 2026");
    expect(renamed.data.school.folder).toBe(path.join(newDir, path.basename(school.folder)));
    expect(existsSync(path.join(penDrive, DATA_DIR_NAME))).toBe(false);
    expect(existsSync(path.join(newDir, DATA_DIR_MARKER))).toBe(true);
    expect((await pc1.books!.getDashboard()).school.diseCode).toBe("24160200030");

    // This PC's list points at the new place for both schools.
    const listed = await pc1.listSchools();
    expect(listed.schools.every((item) => item.availability === "ready")).toBe(true);
    expect(listed.schools.find((item) => item.profileId === other.profileId)?.folder).toBe(
      path.join(newDir, path.basename(other.folder)),
    );

    // Another PC that never saw the new name finds it at the top of the drive.
    const pc2 = w.pc();
    await pc2.signIn(EMAIL, PASSWORD);
    const seen = await pc2.listSchools();
    expect(seen.schools.map((item) => item.availability)).toEqual(["ready", "ready"]);
  });

  it("is found by the marker when renamed by hand, even when picked from the drive", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    await createSchool(pc1, penDrive, "24160200040");
    await pc1.closeSchool(0);

    renameSync(path.join(penDrive, DATA_DIR_NAME), path.join(penDrive, "Junu Naam"));
    expect(findProfilesIn(penDrive)).toHaveLength(1);
    expect((await pc1.listSchools()).schools[0]?.availability).toBe("ready");
  });

  it("refuses an unusable name or one that is taken", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    await createSchool(pc1, penDrive, "24160200050");
    mkdirSync(path.join(penDrive, "Taken"));

    for (const name of ["", "a/b", "a:b", "trailing."]) {
      expect((await pc1.renameDataFolder(name)).ok).toBe(false);
    }
    const taken = await pc1.renameDataFolder("Taken");
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.issues[0]?.code).toBe("folder_exists");
    expect(pc1.getAppState().phase).toBe("open");
  });
});
