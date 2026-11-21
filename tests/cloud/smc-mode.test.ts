/**
 * The SMC mode as the app controller sees it: its schools are separate from SMC
 * E's, and its grant limits can be copied into every other SMC school.
 */
import { afterAll, describe, expect, it } from "vitest";
import { AppController } from "../../src/server/app-controller.js";
import { PLAIN_BOX } from "../../src/server/cloud/account.js";
import { FakeCloud } from "../../src/server/cloud/fake.js";
import { readSyncState } from "../../src/server/profiles/data-folder.js";
import { rupeesToPaise } from "../../src/lib/money.js";
import { MIGRATIONS, ManualTimers, cleanUpTemp, setupInput, tempDir } from "./helpers.js";

const controllers: AppController[] = [];
afterAll(async () => {
  for (const controller of controllers) await controller.closeSchool(0);
  cleanUpTemp();
});

const PASSWORD = "correct horse 1";
const EMAIL = "head@school.in";

function world() {
  const timers = new ManualTimers();
  const codes: string[] = [];
  const cloud = new FakeCloud({
    dir: tempDir("cloud"),
    onCode: (_email, code) => codes.push(code),
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
  return { pc, plugIn: (...roots: string[]) => (drives = roots), lastCode: () => codes.at(-1)! };
}

async function signedIn(w: ReturnType<typeof world>): Promise<AppController> {
  const controller = w.pc();
  await controller.signUp(EMAIL, PASSWORD);
  const verified = await controller.verifySignUp(EMAIL, w.lastCode());
  if (!verified.ok) throw new Error(JSON.stringify(verified.issues));
  return controller;
}

async function createSchool(controller: AppController, at: string, diseCode: string, nameGu: string) {
  const created = await controller.createSchool(at, setupInput({ diseCode, nameGu }));
  if (!created.ok || created.data.phase !== "open") throw new Error(JSON.stringify(created));
  return created.data.school;
}

describe("SMC mode", { timeout: 30_000 }, () => {
  it("keeps its schools apart from SMC E's, even with the same DISE code", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);

    await pc1.setAppMode("smc-e");
    const smcE = await createSchool(pc1, penDrive, "24160200301", "આલમપુરા (SMC E)");
    await pc1.setAppMode("smc");
    const smc = await createSchool(pc1, penDrive, "24160200301", "આલમપુરા (SMC)");
    expect(smc.profileId).not.toBe(smcE.profileId);
    expect(smc.folder).not.toBe(smcE.folder);

    // Each mode lists only its own school.
    const inSmc = (await pc1.listSchools()).schools.filter((school) => school.diseCode === "24160200301");
    expect(inSmc.map((school) => school.profileId)).toEqual([smc.profileId]);
    await pc1.setAppMode("smc-e");
    const inSmcE = (await pc1.listSchools()).schools.filter((school) => school.diseCode === "24160200301");
    expect(inSmcE.map((school) => school.profileId)).toEqual([smcE.profileId]);
  });

  it("copies the open school's limits into the other SMC schools only, by grant head code", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);

    await pc1.setAppMode("smc-e");
    const smcE = await createSchool(pc1, penDrive, "24160200400", "SMC E શાળા");
    await pc1.setAppMode("smc");
    const second = await createSchool(pc1, penDrive, "24160200402", "બીજી SMC શાળા");
    await createSchool(pc1, penDrive, "24160200401", "પહેલી SMC શાળા");

    const limits = await pc1.books!.listGrantLimits();
    const [a, b] = limits;
    const saved = await pc1.books!.saveGrantLimits([
      { grantHeadId: a!.grantHeadId, limitPaise: rupeesToPaise(25000) },
      { grantHeadId: b!.grantHeadId, limitPaise: rupeesToPaise(3000) },
    ]);
    expect(saved.ok).toBe(true);

    const result = await pc1.applyLimitsToAllSchools();
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ applied: ["બીજી SMC શાળા"], skipped: [] });
    expect(readSyncState(second.folder).pendingSince).not.toBeNull();
    expect(readSyncState(smcE.folder).pendingSince ?? null).toBeNull();

    const opened = await pc1.openSchool(second.profileId);
    expect(opened.ok).toBe(true);
    const copied = await pc1.books!.listGrantLimits();
    expect(copied.find((row) => row.headCode === a!.headCode)?.limitPaise).toBe(rupeesToPaise(25000));
    expect(copied.find((row) => row.headCode === b!.headCode)?.limitPaise).toBe(rupeesToPaise(3000));
  });

  it("refuses to copy limits outside SMC", async () => {
    const w = world();
    const penDrive = tempDir("pendrive");
    w.plugIn(penDrive);
    const pc1 = await signedIn(w);
    await pc1.setAppMode("smc-e");
    await createSchool(pc1, penDrive, "24160200500", "SMC E શાળા");
    const result = await pc1.applyLimitsToAllSchools();
    expect(!result.ok && result.issues[0]?.code).toBe("limits_outside_smc");
  });
});
