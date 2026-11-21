/**
 * The application around the books: who is signed in on this PC, which
 * school's data folder is open, and keeping its cloud backup current.
 *
 * The model is Tally's. The software is installed on every PC. A school's data
 * is a folder the user chose - usually on a pen drive - and moving the pen drive
 * moves the books. The only things the PCs share are the account and the
 * software; everything else about a school is in its folder
 * (src/server/profiles/data-folder.ts).
 *
 * This class knows nothing about Electron. The main process wires IPC and the
 * file dialogs to it, so all of this can be tested with the fake cloud and a
 * temporary folder standing in for the pen drive.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, renameSync, rmSync, rmdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import type { PrismaClient } from "@prisma/client";
import { runMigrations, NewerDataError } from "../../electron/migrate.js";
import type { Issue } from "../engine/validation.js";
import { createPrismaClient } from "../lib/db.js";
import {
  APP_MODES,
  PRINTABLE_REPORTS,
  type ApiResult,
  type ApplyLayoutResultDto,
  type ApplyLimitsResultDto,
  type AppMode,
  type AppModeStateDto,
  type AppStateDto,
  type BackupStatusDto,
  type CloudBackupDto,
  type CloudInfoDto,
  type DeleteSchoolResultDto,
  type FolderInspectionDto,
  type LayoutSkipReason,
  type OpenSchoolResultDto,
  type PrintableReportId,
  type SchoolListDto,
  type SchoolListItemDto,
  type SetupInput,
} from "../shared/api.js";
import type { ReportLayout } from "../shared/report-layout.js";
import { AccountsService } from "./accounts-service.js";
import { CloudBackups, type Timers } from "./backup/cloud-backups.js";
import { Account, type SecretBox } from "./cloud/account.js";
import { sha256 } from "./cloud/checksum.js";
import { CloudError, type CloudBackend, type CloudBackup, type CloudProfile } from "./cloud/types.js";
import {
  acquireLock,
  booksFile,
  DATA_DIR_MARKER,
  findProfilesIn,
  folderForNewSchool,
  isDataDir,
  isWritableLocation,
  keyMatches,
  LOCK_FILE,
  lockSchema,
  MANIFEST_FILE,
  markDataDir,
  newManifest,
  readManifest,
  readSyncState,
  releaseLock,
  safeFolderName,
  takeLocalBackup,
  writeManifest,
  writeSyncState,
  type Device,
  type FoundProfile,
  type Manifest,
} from "./profiles/data-folder.js";
import { readJson, writeBytesAtomic, writeJsonAtomic } from "./profiles/json-file.js";
import { KnownProfiles } from "./profiles/known-profiles.js";
import { locateProfile, mountedRoots, type Platform } from "./profiles/locate.js";
import { SetupService, validateSetupInput } from "./setup-service.js";
import { encryptCopy, generateKeyHex, isPlainDatabase, openEncrypted, VaultError, wrapKeyForSupport } from "./vault.js";
import { z } from "zod";

export interface ControllerOptions {
  /** This PC's own data folder (Electron's userData). Never the pen drive. */
  userDataDir: string;
  migrationsDir: string;
  cloud: { backend: CloudBackend; info: CloudInfoDto } | { unavailable: string };
  secretBox: SecretBox;
  appVersion: string;
  platform: Platform;
  /** The drives a pen drive could be on. Defaults to what is mounted now. */
  roots?: () => string[];
  /** Books from before schools had folders, to offer moving them into one. */
  legacyBooks?: { file: string; developmentCopy: boolean } | null;
  timers?: Timers;
  now?: () => number;
  standaloneDb?: string | null;
}

interface OpenSchool {
  profileId: string;
  folder: string;
  manifest: Manifest;
  keyHex: string;
  prisma: PrismaClient;
  setup: SetupService;
  books: AccountsService | null;
  yearLabel: string;
  schemaVersion: string;
}

/** How long closing a school waits for an owed backup before giving up. */
const CLOSE_FLUSH_MS = 10_000;

export class AppController {
  private readonly known: KnownProfiles;
  private readonly device: Device;
  private readonly account: Account | null;
  private readonly backups: CloudBackups | null;
  private current: OpenSchool | null = null;
  private dataMissing = false;
  private standalone = false;
  private modePref: ModePreference;
  private activeMode: AppMode | null;

  constructor(private readonly options: ControllerOptions) {
    this.known = new KnownProfiles(options.userDataDir);
    this.device = loadDevice(options.userDataDir);
    this.modePref = loadModePreference(options.userDataDir);
    this.activeMode = this.modePref.remember ? this.modePref.savedMode : null;
    if (options.standaloneDb && existsSync(options.standaloneDb)) {
      this.standalone = true;
    }
    if ("backend" in options.cloud) {
      this.account = new Account(options.cloud.backend, options.userDataDir, options.secretBox, options.now);
      this.backups = new CloudBackups(
        this.account,
        { appVersion: options.appVersion, deviceName: this.device.name },
        options.timers,
        options.now,
      );
    } else {
      this.account = null;
      this.backups = null;
    }
  }

  /** Open an unencrypted standalone testing database directly without cloud requirements. */
  async openStandaloneDatabase(filePath: string): Promise<void> {
    const migration = runMigrations(filePath, this.options.migrationsDir);
    const prisma = createPrismaClient({ file: filePath });
    const year = await latestYear(prisma);
    const school = await prisma.school.findFirst();
    const manifest: Manifest = {
      format: "smc-accounts-profile",
      formatVersion: 1,
      profileId: "standalone-testing-profile",
      ownerUserId: "standalone-tester",
      schoolNameGu: school?.nameGu ?? "બેટાવાડાના મુવાડા પ્રા. શાળા",
      diseCode: school?.diseCode ?? "24160201802",
      cipher: "chacha20",
      keyFingerprint: "plain",
      createdAt: new Date().toISOString(),
    };
    this.current = {
      profileId: manifest.profileId,
      folder: path.dirname(filePath),
      manifest,
      keyHex: "",
      prisma,
      setup: new SetupService(prisma),
      books: year ? new AccountsService(prisma, year.id, () => this.effectiveMode()) : null,
      yearLabel: year?.label ?? "",
      schemaVersion: migration.schemaVersion,
    };
    this.standalone = true;
    this.dataMissing = false;
  }

  // ------------------------------------------------------------------ state

  private modeDto(): AppModeStateDto {
    return {
      active: this.activeMode,
      remember: this.modePref.remember,
      savedMode: this.modePref.savedMode,
    };
  }

  private effectiveMode(): AppMode {
    return this.activeMode ?? "smc-e";
  }

  private modeForManifest(manifest: Manifest): AppMode {
    return manifest.appMode ?? "smc-e";
  }

  private modeForProfile(profile: { appMode?: AppMode }): AppMode {
    return profile.appMode ?? "smc-e";
  }

  async setAppMode(mode: AppMode): Promise<AppStateDto> {
    const valid = z.enum(APP_MODES).parse(mode);
    if (!this.standalone && this.current && this.activeMode !== valid) {
      await this.closeSchool();
    }
    this.activeMode = valid;
    if (this.modePref.remember) {
      this.modePref = { remember: true, savedMode: valid };
      saveModePreference(this.options.userDataDir, this.modePref);
    }
    return this.getAppState();
  }

  setModeRemember(remember: boolean): AppStateDto {
    const savedMode = remember ? (this.activeMode ?? this.modePref.savedMode) : null;
    this.modePref = { remember, savedMode };
    saveModePreference(this.options.userDataDir, this.modePref);
    return this.getAppState();
  }

  getAppState(): AppStateDto {
    if (this.standalone && this.current) {
      const current = this.current;
      const user = { id: "tester", email: "test@smc.gov.in" };
      const cloud: CloudInfoDto = { kind: "fake", note: null };
      const school = {
        profileId: current.profileId,
        schoolNameGu: current.manifest.schoolNameGu,
        diseCode: current.manifest.diseCode,
        folder: current.folder,
      };
      return {
        phase: "open",
        cloud,
        user,
        school,
        needsSetup: current.books === null,
        mode: {
          active: this.activeMode ?? "smc-e",
          remember: this.modePref.remember,
          savedMode: this.modePref.savedMode,
        },
      };
    }

    const cloud = this.options.cloud;
    if (!("backend" in cloud) || !this.account) {
      return { phase: "unavailable", reason: "unavailable" in cloud ? cloud.unavailable : "" };
    }
    const user = this.account.user;
    if (!user) return { phase: "signedOut", cloud: cloud.info };
    const mode = this.modeDto();
    const current = this.current;
    if (!current) return { phase: "chooseSchool", cloud: cloud.info, user, mode };
    const school = {
      profileId: current.profileId,
      schoolNameGu: current.manifest.schoolNameGu,
      diseCode: current.manifest.diseCode,
      folder: current.folder,
    };
    if (this.dataMissing) return { phase: "dataMissing", cloud: cloud.info, user, school, mode };
    return { phase: "open", cloud: cloud.info, user, school, needsSetup: current.books === null, mode };
  }

  /** The open school's books, or null when none is open or its drive is gone. */
  get books(): AccountsService | null {
    return this.dataMissing ? null : (this.current?.books ?? null);
  }

  get setup(): SetupService | null {
    return this.dataMissing ? null : (this.current?.setup ?? null);
  }

  get yearLabel(): string {
    return this.current?.yearLabel ?? "";
  }

  /** closeYear and openYear change which year is shown. */
  switchYear(yearId: number, label: string): void {
    const current = this.current;
    if (!current) throw new Error("no school is open");
    current.books = new AccountsService(current.prisma, yearId, () => this.effectiveMode());
    current.yearLabel = label;
  }

  /** After setup filled an empty school database: bind its first year. */
  async afterSetup(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const year = await latestYear(current.prisma);
    if (year) this.switchYear(year.id, year.label);
    await this.refreshManifest(current);
  }

  /** Every successful write to the books calls this. */
  onBooksChanged(): void {
    if (this.standalone) return;
    this.backups?.markChanged();
  }

  /**
   * Delete a financial year after verifying the user's account password.
   */
  async deleteYear(input: { yearId: number; password?: string }): Promise<ApiResult<{ deletedYearId: number; switchedToYearId?: number }>> {
    const current = this.current;
    if (!current || !current.books) {
      return failure(issue("no_school_open", "કોઈ શાળા ખૂલેલી નથી.", "No school is open."));
    }

    // 1. Password verification for safety
    const wrongPassword = await this.checkPassword(input.password, "deleteYear");
    if (wrongPassword) return failure(wrongPassword);

    // 2. Perform delete in books
    const deleteResult = await current.books.deleteYear(input);
    if (!deleteResult.ok) {
      return deleteResult;
    }

    // 3. If the active year was deleted, switch to another remaining year
    let switchedToYearId: number | undefined;
    if (input.yearId === current.books.currentYearId) {
      const remaining = await current.prisma.financialYear.findFirst({
        orderBy: { label: "desc" },
      });
      if (remaining) {
        this.switchYear(remaining.id, remaining.label);
        switchedToYearId = remaining.id;
      }
    }

    this.onBooksChanged();
    return {
      ok: true,
      data: {
        deletedYearId: input.yearId,
        switchedToYearId,
      },
    };
  }

  // ------------------------------------------------- deleting a whole school

  /**
   * Delete a school: out of the account in the cloud, and its data folder off
   * the pen drive or PC when it is reachable.
   *
   * The account password is asked again, and the cloud goes first: without the
   * internet nothing is deleted at all, so a school is never left deleted here
   * but still listed (and openable) everywhere else.
   */
  async deleteSchool(profileId: string, password: string): Promise<ApiResult<DeleteSchoolResultDto>> {
    const account = this.account;
    const user = account?.user;
    if (!account || !user) return failure(ISSUES.notSignedIn());
    const wrongPassword = await this.checkPassword(password, "deleteSchool");
    if (wrongPassword) return failure(wrongPassword);

    // Found before anything changes: a folder is only deleted once it is known
    // to be this school's and this account's.
    const open = this.current?.profileId === profileId ? this.current : null;
    const found = open ? { folder: open.folder, manifest: open.manifest } : this.locate(profileId);
    if (found) {
      const cached = account.cachedKey(profileId);
      const mine = found.manifest.ownerUserId === user.id || Boolean(cached && keyMatches(found.manifest, cached));
      if (!mine) return failure(ISSUES.otherAccount());
    }

    try {
      await account.withSession((session) => account.backend.deleteProfile(session, profileId));
    } catch (error) {
      // Not in this account's cloud (never synced, or already deleted): the
      // local part still has to go.
      if (!(error instanceof CloudError && error.code === "not-found")) {
        return failure(this.errorIssue(error, "deleteSchool"));
      }
    }

    // No backup is owed any more - the cloud would refuse it - so the books are
    // let go without the usual flush.
    if (open) await this.discardCurrent();

    this.known.forget(profileId);
    account.forgetKey(profileId);

    let folderRemoved: string | null = null;
    if (found) {
      try {
        removeSchoolFolder(found.folder);
        folderRemoved = found.folder;
      } catch (error) {
        return failure(ISSUES.folderNotRemoved(found.folder, error instanceof Error ? error.message : String(error)));
      }
    }
    return { ok: true, data: { list: await this.listSchools(), folderRemoved } };
  }

  // ------------------------------------------- one layout for every school

  /**
   * Copy the open school's saved layout of `report` into every other school of
   * this account that this PC can reach right now. Each one gets a local copy
   * of its books first, and owes a cloud backup afterwards, just as if the
   * layout had been saved while it was open.
   *
   * Schools that cannot be reached are listed with the reason rather than
   * failing the whole thing: a pen drive that is not plugged in is normal.
   */
  async applyLayoutToAllSchools(report: PrintableReportId): Promise<ApiResult<ApplyLayoutResultDto>> {
    const current = this.current;
    const account = this.account;
    const user = account?.user;
    if (!current || this.dataMissing || !current.books) return failure(ISSUES.noSchoolOpen());
    if (!account || !user) return failure(ISSUES.notSignedIn());
    if (!PRINTABLE_REPORTS.includes(report)) {
      return failure(issue("unknown_report", "આવો રિપોર્ટ નથી", `no printable report called ${report}`));
    }
    const layout = await current.books.getReportLayout(report);

    const applied: string[] = [];
    const skipped: ApplyLayoutResultDto["skipped"] = [];
    for (const [profileId, schoolNameGu] of await this.otherSchoolsOfThisMode(current.profileId, user.id)) {
      const reason = await this.withOtherSchoolBooks<never>(profileId, "before-layout", async (prisma) => {
        const year = await latestYear(prisma);
        if (!year) return "notSetUp" as const;
        const saved = await new AccountsService(prisma, year.id).saveReportLayout(report, layout);
        return saved.ok ? null : ("failed" as const);
      });
      if (reason === null) applied.push(schoolNameGu);
      else skipped.push({ profileId, schoolNameGu, reason });
    }
    return { ok: true, data: { applied, skipped } };
  }

  /**
   * SMC mode: copy the open school's grant limits into every other SMC school of
   * this account that this PC can reach - into its year with the same label,
   * heads matched by code. Unreachable schools are listed with the reason, as
   * for layouts.
   */
  async applyLimitsToAllSchools(): Promise<ApiResult<ApplyLimitsResultDto>> {
    const current = this.current;
    const account = this.account;
    const user = account?.user;
    if (!current || this.dataMissing || !current.books) return failure(ISSUES.noSchoolOpen());
    if (!account || !user) return failure(ISSUES.notSignedIn());
    if (this.effectiveMode() !== "smc") {
      return failure(issue("limits_outside_smc", "લિમિટ માત્ર SMC માં છે", "grant limits belong to SMC mode only"));
    }
    const limits = await current.books.listGrantLimits();
    const byCode = new Map(limits.map((row) => [row.headCode, row.limitPaise]));
    const yearLabel = current.yearLabel;

    const applied: string[] = [];
    const skipped: ApplyLimitsResultDto["skipped"] = [];
    for (const [profileId, schoolNameGu] of await this.otherSchoolsOfThisMode(current.profileId, user.id)) {
      const reason = await this.withOtherSchoolBooks<"noSuchYear">(profileId, "before-limits", async (prisma) => {
        const year = await prisma.financialYear.findFirst({ where: { label: yearLabel } });
        if (!year) return (await latestYear(prisma)) ? ("noSuchYear" as const) : ("notSetUp" as const);
        const saved = await new AccountsService(prisma, year.id, () => "smc").mergeGrantLimitsByCode(byCode);
        return saved.ok ? null : ("failed" as const);
      });
      if (reason === null) applied.push(schoolNameGu);
      else skipped.push({ profileId, schoolNameGu, reason });
    }
    return { ok: true, data: { applied, skipped } };
  }

  /** Every other school of this account in the active mode: this PC's list, then the cloud's. */
  private async otherSchoolsOfThisMode(currentProfileId: string, userId: string): Promise<Map<string, string>> {
    const account = this.account;
    const mode = this.effectiveMode();
    const targets = new Map<string, string>();
    for (const known of this.known.all()) {
      if (known.ownerUserId === userId && this.modeForProfile(known) === mode) {
        targets.set(known.profileId, known.schoolNameGu);
      }
    }
    try {
      if (account) {
        const inCloud = await account.withSession((session) => account.backend.listProfiles(session));
        for (const profile of inCloud) {
          if (this.modeForProfile(profile) === mode && !targets.has(profile.id)) {
            targets.set(profile.id, profile.schoolNameGu);
          }
        }
      }
    } catch {
      // Offline: the schools this PC knows are enough.
    }
    targets.delete(currentProfileId);
    return targets;
  }

  /**
   * Open another school's books for one change, the way a layout is copied: a
   * local backup first, its lock held throughout, and a cloud backup owed after.
   * The work returns null when it changed the books, or why it did not.
   */
  private async withOtherSchoolBooks<Reason extends string = never>(
    profileId: string,
    backupTag: string,
    work: (prisma: PrismaClient) => Promise<Reason | LayoutSkipReason | null>,
  ): Promise<Reason | LayoutSkipReason | null> {
    const found = this.locate(profileId);
    if (!found) return "notConnected";
    if (this.modeForManifest(found.manifest) !== this.effectiveMode()) return "failed";
    let keyHex: string;
    try {
      keyHex = await this.keyFor(found.manifest);
    } catch {
      return "noKey";
    }
    if (!acquireLock(found.folder, this.device).ok) return "openElsewhere";

    let prisma: PrismaClient | null = null;
    try {
      takeLocalBackup(found.folder, keyHex, backupTag);
      runMigrations(booksFile(found.folder), this.options.migrationsDir, { keyHex });
      prisma = createPrismaClient({ file: booksFile(found.folder), keyHex });
      const reason = await work(prisma);
      if (reason !== null) return reason;
      const sync = readSyncState(found.folder);
      if (!sync.pendingSince) writeSyncState(found.folder, { ...sync, pendingSince: new Date(this.now()).toISOString() });
      return null;
    } catch (error) {
      if (error instanceof NewerDataError) return "newerData";
      console.error(`changing school ${profileId} failed:`, error);
      return "failed";
    } finally {
      await prisma?.$disconnect().catch(() => undefined);
      releaseLock(found.folder, this.device);
    }
  }

  // ----------------------------------------------- renaming the data folder

  /**
   * Rename the folder that holds the open school's folder - "SMC Accounts"
   * unless the user changed it. Every school kept in it moves along, and this
   * PC's list is pointed at the new place. Another PC that remembers the old
   * name finds it again by itself when it is at the top of a drive (the marker
   * file), and otherwise through "Find folder" on the school list.
   */
  async renameDataFolder(newName: string): Promise<ApiResult<AppStateDto>> {
    const current = this.current;
    if (!current || this.dataMissing || this.standalone) return failure(ISSUES.noSchoolOpen());

    const name = newName.trim();
    if (name === "" || safeFolderName(name) !== name || name === "." || name === "..") {
      return failure(ISSUES.badFolderName(name));
    }
    const schoolFolder = current.folder;
    const dataDir = path.dirname(schoolFolder);
    const parent = path.dirname(dataDir);
    if (parent === dataDir) return failure(ISSUES.folderAtDriveRoot());
    const target = path.join(parent, name);
    if (target === dataDir) return { ok: true, data: this.getAppState() };
    // A change of case alone is a rename on Windows, not a clash.
    if (existsSync(target) && target.toLowerCase() !== dataDir.toLowerCase()) {
      return failure(ISSUES.folderExists(target));
    }

    // Every school in it moves, so none may be open on another PC.
    const inside = findProfilesIn(dataDir).filter((school) => school.folder !== dataDir);
    for (const school of inside) {
      const holder = readJson(path.join(school.folder, LOCK_FILE), lockSchema);
      if (holder && holder.deviceId !== this.device.id) {
        return failure(ISSUES.folderInUse(school.manifest.schoolNameGu, holder.deviceName));
      }
    }

    const profileId = current.profileId;
    // Windows cannot rename a folder with the books open inside it.
    await this.closeSchool();
    try {
      renameSync(dataDir, target);
    } catch (error) {
      await this.openSchool(profileId, { folder: schoolFolder, force: true });
      return failure(ISSUES.renameFailed(dataDir, error instanceof Error ? error.message : String(error)));
    }
    markDataDir(target);

    for (const school of inside) {
      const known = this.known.get(school.manifest.profileId);
      if (known) this.known.remember({ ...known, folder: path.join(target, path.relative(dataDir, school.folder)) });
    }

    const opened = await this.openSchool(profileId, {
      folder: path.join(target, path.basename(schoolFolder)),
      force: true,
    });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  // ---------------------------------------------------------------- account

  async signIn(email: string, password: string): Promise<ApiResult<AppStateDto>> {
    return this.cloudCall(async (account) => {
      await account.signIn(email, password);
      return this.getAppState();
    });
  }

  async signUp(email: string, password: string): Promise<ApiResult<{ needsCode: boolean }>> {
    return this.cloudCall(async (account) => {
      const user = await account.signUp(email, password);
      return { needsCode: user === null };
    });
  }

  async verifySignUp(email: string, code: string): Promise<ApiResult<AppStateDto>> {
    return this.cloudCall(async (account) => {
      await account.verifySignUp(email, code);
      return this.getAppState();
    });
  }

  async requestPasswordReset(email: string): Promise<ApiResult<null>> {
    return this.cloudCall(async (account) => {
      await account.requestPasswordReset(email);
      return null;
    });
  }

  async completePasswordReset(email: string, code: string, password: string): Promise<ApiResult<AppStateDto>> {
    return this.cloudCall(async (account) => {
      await account.completePasswordReset(email, code, password);
      return this.getAppState();
    });
  }

  async signOut(): Promise<AppStateDto> {
    await this.closeSchool();
    await this.account?.signOut();
    if (!this.modePref.remember) {
      this.activeMode = null;
    }
    return this.getAppState();
  }

  // ---------------------------------------------------------------- schools

  async listSchools(): Promise<SchoolListDto> {
    const account = this.account;
    const user = account?.user;
    if (!account || !user) return { schools: [], cloudReachable: false, legacyBooks: null };

    // An account its owner has withdrawn is signed out here; the next state
    // check shows the login, which then says why.
    if (!(await account.stillApproved())) return { schools: [], cloudReachable: false, legacyBooks: null };

    let inCloud: CloudProfile[] | null = null;
    try {
      inCloud = await account.withSession((session) => account.backend.listProfiles(session));
    } catch {
      // Offline, or the session ended (then the next state check shows the login).
    }

    const mode = this.effectiveMode();
    const schools: SchoolListItemDto[] = [];
    for (const known of this.known.all()) {
      if (this.modeForProfile(known) !== mode) continue;
      const found = this.locate(known.profileId);
      if (found && this.modeForManifest(found.manifest) !== mode) continue;
      const matchesUser = known.ownerUserId === user.id;
      const cached = this.account?.cachedKey(known.profileId);
      const isOwnedLocally = Boolean(found && cached && keyMatches(found.manifest, cached));
      if (!matchesUser && !isOwnedLocally) continue;

      if (!matchesUser && isOwnedLocally) {
        this.known.remember({ ...known, appMode: mode, ownerUserId: user.id });
      }
      if (found && found.folder !== known.folder) {
        this.known.remember({ ...known, appMode: mode, folder: found.folder, ownerUserId: user.id });
      }
      schools.push({
        profileId: known.profileId,
        schoolNameGu: known.schoolNameGu,
        diseCode: known.diseCode,
        folder: found?.folder ?? known.folder,
        availability: found ? "ready" : "notConnected",
        lastOpenedAt: known.lastOpenedAt,
      });
    }
    for (const profile of inCloud ?? []) {
      if (this.modeForProfile(profile) !== mode) continue;
      if (schools.some((school) => school.profileId === profile.id)) continue;
      const located = this.locate(profile.id);
      const found = located && this.modeForManifest(located.manifest) === mode ? located : null;
      schools.push({
        profileId: profile.id,
        schoolNameGu: profile.schoolNameGu,
        diseCode: profile.diseCode,
        folder: found?.folder ?? null,
        availability: found ? "ready" : "notOnThisPc",
        lastOpenedAt: null,
      });
    }

    const order = { ready: 0, notConnected: 1, notOnThisPc: 2 } as const;
    schools.sort(
      (a, b) =>
        order[a.availability] - order[b.availability] ||
        (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? "") ||
        a.schoolNameGu.localeCompare(b.schoolNameGu),
    );

    return { schools, cloudReachable: inCloud !== null, legacyBooks: this.legacyBooks() };
  }

  inspectFolder(folder: string): ApiResult<FolderInspectionDto> {
    const user = this.account?.user;
    if (!user) return failure(ISSUES.notSignedIn());
    const found = findProfilesIn(folder);
    if (found.length === 0) return failure(ISSUES.noSchoolInFolder(folder));
    return {
      ok: true,
      data: {
        folder,
        schools: found.map(({ folder: at, manifest }) => {
          const cached = this.account?.cachedKey(manifest.profileId);
          const hasKey = Boolean(cached && keyMatches(manifest, cached));
          return {
            profileId: manifest.profileId,
            schoolNameGu: manifest.schoolNameGu,
            diseCode: manifest.diseCode,
            appMode: this.modeForManifest(manifest),
            folder: at,
            ownedByMe: manifest.ownerUserId === user.id || hasKey,
          };
        }),
      },
    };
  }

  /**
   * A new school: validate the form, build its encrypted database in a new
   * folder inside `location`, run setup, and only then register it (and its
   * key) with the account. If anything fails, the new folder is removed, so a
   * failed attempt leaves nothing behind - on the pen drive or in the cloud.
   */
  async createSchool(location: string, input: SetupInput): Promise<ApiResult<AppStateDto>> {
    const account = this.account;
    const user = account?.user;
    if (!account || !user) return failure(ISSUES.notSignedIn());

    const invalid = validateSetupInput(input);
    if (invalid) return invalid;
    if (!isWritableLocation(location)) return failure(ISSUES.notWritable(location));

    // Needs the internet anyway (the key must reach the account), so ask first:
    // it also catches creating the same school twice.
    let existing: CloudProfile[];
    try {
      existing = await account.withSession((session) => account.backend.listProfiles(session));
    } catch (error) {
      return failure(cloudIssue(error, "createSchool"));
    }
    const mode = this.effectiveMode();
    const diseCode = input.school.diseCode.trim();
    if (existing.some((profile) => profile.diseCode === diseCode && this.modeForProfile(profile) === mode)) {
      return failure(ISSUES.schoolExists(diseCode));
    }

    await this.closeSchool();

    const profileId = randomUUID();
    const keyHex = generateKeyHex();
    const folder = folderForNewSchool(location, diseCode, mode);
    const madeDataDir = !existsSync(path.dirname(folder));
    const manifest = newManifest({
      profileId,
      ownerUserId: user.id,
      schoolNameGu: input.school.nameGu.trim(),
      diseCode,
      appMode: mode,
      keyHex,
    });

    try {
      writeManifest(folder, manifest);
      runMigrations(booksFile(folder), this.options.migrationsDir, { keyHex });
      const prisma = createPrismaClient({ file: booksFile(folder), keyHex });
      try {
        const result = await new SetupService(prisma).completeSetup(input);
        if (!result.ok) {
          removeNewFolder(folder, madeDataDir);
          return result;
        }
      } finally {
        await prisma.$disconnect();
      }
      await account.withSession((session) =>
        account.backend.createProfile(session, {
          id: profileId,
          schoolNameGu: manifest.schoolNameGu,
          diseCode,
          keyHex,
          appMode: mode,
        }),
      );
      account.rememberKey(profileId, keyHex);
    } catch (error) {
      removeNewFolder(folder, madeDataDir);
      return failure(this.errorIssue(error, "createSchool"));
    }

    // A brand-new school owes its first backup straight away.
    writeSyncState(folder, { pendingSince: new Date(this.now()).toISOString(), lastCloudBackup: null });
    const opened = await this.openSchool(profileId, { folder });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  /**
   * Open a school's books.
   *
   * The key comes from this PC's cache, or from the account once - which is why
   * opening a school on a PC for the first time needs the internet, and every
   * time after that does not.
   */
  async openSchool(
    profileId: string,
    options: { folder?: string; force?: boolean } = {},
  ): Promise<ApiResult<OpenSchoolResultDto>> {
    const account = this.account;
    const user = account?.user;
    if (!account || !user) return failure(ISSUES.notSignedIn());
    if (!(await account.stillApproved())) {
      return failure(cloudIssue(new CloudError("not-approved", "approval withdrawn"), "openSchool"));
    }

    await this.closeSchool();

    const found = options.folder ? profileAt(options.folder, profileId) : this.locate(profileId);
    if (!found) return failure(ISSUES.notConnected());

    const ownerMode = this.modeForManifest(found.manifest);
    if (ownerMode !== this.effectiveMode()) {
      return failure(ISSUES.wrongMode(ownerMode));
    }

    let keyHex: string;
    try {
      keyHex = await this.keyFor(found.manifest);
    } catch (error) {
      if (found.manifest.ownerUserId !== user.id) {
        return failure(ISSUES.otherAccount());
      }
      return failure(this.errorIssue(error, "openSchool"));
    }

    // Ownership reconciliation: if the user holds the matching encryption key,
    // they are the legitimate owner. Update ownerUserId if it was created under an old backend user ID.
    if (found.manifest.ownerUserId !== user.id) {
      found.manifest = {
        ...found.manifest,
        ownerUserId: user.id,
      };
      writeManifest(found.folder, found.manifest);
      this.known.remember({
        profileId: found.manifest.profileId,
        ownerUserId: user.id,
        schoolNameGu: found.manifest.schoolNameGu,
        diseCode: found.manifest.diseCode,
        appMode: ownerMode,
        folder: found.folder,
        lastOpenedAt: new Date(this.now()).toISOString(),
      });
    }

    // Envelope encryption upgrade: ensure supportWrappedKey is present and formatVersion is 2
    if (!found.manifest.supportWrappedKey || found.manifest.formatVersion < 2) {
      found.manifest = {
        ...found.manifest,
        formatVersion: 2,
        supportWrappedKey: wrapKeyForSupport(keyHex),
      };
      writeManifest(found.folder, found.manifest);
    }

    const lock = acquireLock(found.folder, this.device, { force: options.force });
    if (!lock.ok) {
      return {
        ok: true,
        data: { opened: false, lockedBy: { deviceName: lock.holder.deviceName, openedAt: lock.holder.openedAt } },
      };
    }

    try {
      await this.bind(found, keyHex);
    } catch (error) {
      releaseLock(found.folder, this.device);
      return failure(this.errorIssue(error, "openSchool"));
    }

    // Re-sync to cloud if missing in current backend (e.g. after backend migration)
    try {
      const inCloud = await account.withSession((session) => account.backend.listProfiles(session));
      if (!inCloud.some((p) => p.id === found.manifest.profileId)) {
        await account.withSession((session) =>
          account.backend.createProfile(session, {
            id: found.manifest.profileId,
            schoolNameGu: found.manifest.schoolNameGu,
            diseCode: found.manifest.diseCode,
            keyHex,
            appMode: ownerMode,
          }),
        );
        this.backups?.markChanged();
      }
    } catch {
      // Offline or network error: ignore, offline opening still succeeds!
    }

    return { ok: true, data: { opened: true, state: this.getAppState() } };
  }

  /** Close the open school: send what backup is owed (briefly), then let go. */
  async closeSchool(flushMs = CLOSE_FLUSH_MS): Promise<AppStateDto> {
    const current = this.current;
    if (current) {
      if (!this.dataMissing && !this.standalone) await this.backups?.flush(flushMs);
      this.backups?.detach();
      this.current = null;
      this.dataMissing = false;
      await current.prisma.$disconnect().catch(() => undefined);
      if (!this.standalone) {
        try {
          releaseLock(current.folder, this.device);
        } catch {
          // The drive is gone; its lock goes with it.
        }
      }
    }
    return this.getAppState();
  }

  forgetSchool(profileId: string): Promise<SchoolListDto> {
    this.known.forget(profileId);
    return this.listSchools();
  }

  /**
   * Called every few seconds by the main process. When the open school's
   * folder disappears - the pen drive was pulled out - the books are closed at
   * once, so nothing tries to write to a drive that is not there.
   */
  checkDataPresent(): boolean {
    if (this.standalone) return true;
    const current = this.current;
    if (!current || this.dataMissing) return !this.dataMissing;
    if (existsSync(path.join(current.folder, MANIFEST_FILE))) return true;
    this.dataMissing = true;
    this.backups?.detach();
    void current.prisma.$disconnect().catch(() => undefined);
    return false;
  }

  /** The pen drive is back - perhaps under another drive letter. */
  async reconnectSchool(): Promise<ApiResult<AppStateDto>> {
    const current = this.current;
    if (!current) return { ok: true, data: this.getAppState() };
    const profileId = current.profileId;
    this.current = null;
    this.dataMissing = false;
    await current.prisma.$disconnect().catch(() => undefined);

    const found = this.locate(profileId);
    if (!found) {
      // Still not there: go back to showing the "put the pen drive back" state.
      this.current = current;
      this.dataMissing = true;
      return failure(ISSUES.notConnected());
    }
    const opened = await this.openSchool(profileId, { folder: found.folder, force: true });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  get dataFolder(): string | null {
    return this.current?.folder ?? null;
  }

  // ---------------------------------------------------------------- backups

  getBackupStatus(): BackupStatusDto {
    if (!this.current || !this.backups) {
      return { state: "never", pendingSince: null, lastBackupAt: null, lastBackupDevice: null, lastError: null };
    }
    return this.backups.status();
  }

  async backupNow(): Promise<ApiResult<BackupStatusDto>> {
    if (!this.current || this.dataMissing || !this.backups) return failure(ISSUES.noSchoolOpen());
    try {
      await this.backups.backupNow();
      return { ok: true, data: this.backups.status() };
    } catch (error) {
      return failure(this.errorIssue(error, "backupNow"));
    }
  }

  async listCloudBackups(profileId: string): Promise<ApiResult<CloudBackupDto[]>> {
    const mode = this.effectiveMode();
    const known = this.known.get(profileId);
    if (known && this.modeForProfile(known) !== mode) {
      return failure(ISSUES.wrongMode(this.modeForProfile(known)));
    }
    return this.cloudCall(async (account) => {
      const profiles = await account.withSession((session) => account.backend.listProfiles(session));
      const matched = profiles.find((item) => item.id === profileId);
      if (matched && this.modeForProfile(matched) !== mode) {
        throw new WrongModeError(this.modeForProfile(matched));
      }
      const backups = await account.withSession((session) => account.backend.listBackups(session, profileId));
      return backups.map(toBackupDto);
    });
  }

  /**
   * Replace the open school's books with a cloud backup.
   *
   * The backup is downloaded, its checksum checked, and opened with the key
   * before anything is replaced; the current books are copied to backups\
   * first. So a restore can itself be undone from the local copies.
   */
  async restoreBackup(backupId: string): Promise<ApiResult<AppStateDto>> {
    const current = this.current;
    const account = this.account;
    if (!current || this.dataMissing || !account) return failure(ISSUES.noSchoolOpen());

    let bytes: Uint8Array;
    let backup: CloudBackup;
    try {
      ({ bytes, backup } = await this.download(current.profileId, backupId));
    } catch (error) {
      return failure(this.errorIssue(error, "restoreBackup"));
    }

    const staged = path.join(current.folder, "books.restore.tmp");
    try {
      writeBytesAtomic(staged, bytes);
      verifyBooks(staged, current.keyHex);
    } catch (error) {
      rmSync(staged, { force: true });
      return failure(this.errorIssue(error, "restoreBackup"));
    }

    const { profileId, folder } = current;
    this.backups?.detach();
    this.current = null;
    await current.prisma.$disconnect().catch(() => undefined);
    try {
      takeLocalBackup(folder, current.keyHex, "before-restore");
      renameSync(staged, booksFile(folder));
      // The books now equal a backup the cloud already has.
      writeSyncState(folder, {
        pendingSince: null,
        lastCloudBackup: { id: backup.id, at: backup.createdAt, deviceName: backup.deviceName },
      });
    } catch (error) {
      rmSync(staged, { force: true });
      await this.openSchool(profileId, { folder, force: true });
      return failure(this.errorIssue(error, "restoreBackup"));
    }

    const opened = await this.openSchool(profileId, { folder, force: true });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  /**
   * Bring a school back from the cloud into a new folder: the pen drive was
   * lost or broken. Refused while the school's folder is reachable, which would
   * only make a second copy of it.
   */
  async restoreSchool(profileId: string, backupId: string, location: string): Promise<ApiResult<AppStateDto>> {
    const account = this.account;
    const user = account?.user;
    if (!account || !user) return failure(ISSUES.notSignedIn());
    const located = this.locate(profileId);
    if (located) {
      if (this.modeForManifest(located.manifest) !== this.effectiveMode()) {
        return failure(ISSUES.wrongMode(this.modeForManifest(located.manifest)));
      }
      return failure(ISSUES.schoolAvailable());
    }
    if (!isWritableLocation(location)) return failure(ISSUES.notWritable(location));

    let profile: CloudProfile | undefined;
    let keyHex: string;
    let bytes: Uint8Array;
    let backup: CloudBackup;
    try {
      const profiles = await account.withSession((session) => account.backend.listProfiles(session));
      profile = profiles.find((item) => item.id === profileId);
      if (!profile) return failure(ISSUES.notConnected());
      const ownerMode = this.modeForProfile(profile);
      if (ownerMode !== this.effectiveMode()) {
        return failure(ISSUES.wrongMode(ownerMode));
      }
      keyHex = await account.keyFor(profileId);
      ({ bytes, backup } = await this.download(profileId, backupId));
    } catch (error) {
      return failure(this.errorIssue(error, "restoreSchool"));
    }

    const ownerMode = this.modeForProfile(profile);
    await this.closeSchool();
    const folder = folderForNewSchool(location, profile.diseCode, ownerMode);
    const madeDataDir = !existsSync(path.dirname(folder));
    try {
      writeManifest(
        folder,
        newManifest({
          profileId,
          ownerUserId: user.id,
          schoolNameGu: profile.schoolNameGu,
          diseCode: profile.diseCode,
          appMode: ownerMode,
          keyHex,
          createdAt: profile.createdAt,
        }),
      );
      writeBytesAtomic(booksFile(folder), bytes);
      verifyBooks(booksFile(folder), keyHex);
      writeSyncState(folder, {
        pendingSince: null,
        lastCloudBackup: { id: backup.id, at: backup.createdAt, deviceName: backup.deviceName },
      });
    } catch (error) {
      removeNewFolder(folder, madeDataDir);
      return failure(this.errorIssue(error, "restoreSchool"));
    }

    const opened = await this.openSchool(profileId, { folder });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  /**
   * Move the books kept by the previous version of the app - one unencrypted
   * file in this PC's data folder - into an encrypted school folder. The old
   * file is renamed, not deleted, so nothing is lost if anything goes wrong.
   */
  async moveLegacyBooks(location: string): Promise<ApiResult<AppStateDto>> {
    const account = this.account;
    const user = account?.user;
    const legacy = this.options.legacyBooks;
    if (!account || !user) return failure(ISSUES.notSignedIn());
    if (!legacy || !isPlainDatabase(legacy.file)) return failure(ISSUES.noLegacyBooks());
    if (!isWritableLocation(location)) return failure(ISSUES.notWritable(location));

    const mode = this.effectiveMode();
    const school = readLegacySchool(legacy.file);
    const diseCode = school?.diseCode ?? "";
    try {
      const existing = await account.withSession((session) => account.backend.listProfiles(session));
      if (diseCode && existing.some((profile) => profile.diseCode === diseCode && this.modeForProfile(profile) === mode)) {
        return failure(ISSUES.schoolExists(diseCode));
      }
    } catch (error) {
      return failure(cloudIssue(error, "moveLegacyBooks"));
    }

    await this.closeSchool();
    const profileId = randomUUID();
    const keyHex = generateKeyHex();
    const folder = folderForNewSchool(location, diseCode || "school", mode);
    const madeDataDir = !existsSync(path.dirname(folder));
    const manifest = newManifest({
      profileId,
      ownerUserId: user.id,
      schoolNameGu: school?.nameGu ?? "",
      diseCode,
      appMode: mode,
      keyHex,
    });
    try {
      writeManifest(folder, manifest);
      encryptCopy(legacy.file, booksFile(folder), keyHex);
      runMigrations(booksFile(folder), this.options.migrationsDir, { keyHex });
      await account.withSession((session) =>
        account.backend.createProfile(session, {
          id: profileId,
          schoolNameGu: manifest.schoolNameGu,
          diseCode,
          keyHex,
          appMode: mode,
        }),
      );
      account.rememberKey(profileId, keyHex);
    } catch (error) {
      removeNewFolder(folder, madeDataDir);
      return failure(this.errorIssue(error, "moveLegacyBooks"));
    }

    if (!legacy.developmentCopy) {
      for (const suffix of ["", "-wal", "-shm"]) {
        const from = legacy.file + suffix;
        if (existsSync(from)) renameSync(from, `${legacy.file}.moved${suffix}`);
      }
    }
    writeSyncState(folder, { pendingSince: new Date(this.now()).toISOString(), lastCloudBackup: null });
    const opened = await this.openSchool(profileId, { folder });
    if (!opened.ok) return opened;
    return { ok: true, data: this.getAppState() };
  }

  /** Quitting: like closing the school. */
  shutdown(flushMs = CLOSE_FLUSH_MS): Promise<AppStateDto> {
    return this.closeSchool(flushMs);
  }

  // ------------------------------------------------------------- plumbing

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /**
   * Asked again before anything that cannot be undone. Null when it is right
   * (or there is no account to ask about: the standalone testing database).
   */
  private async checkPassword(password: string | undefined, where: string): Promise<Issue | null> {
    const account = this.account;
    const user = account?.user;
    if (this.standalone || !account || !user) return null;
    if (!password || password.trim() === "") {
      return issue("password_required", "સુરક્ષા માટે ખાતાનો પાસવર્ડ દાખલ કરો.", "Please enter your account password for safety.");
    }
    try {
      await account.backend.signIn(user.email, password);
      return null;
    } catch (error) {
      if (error instanceof CloudError && error.code === "invalid-credentials") {
        return issue("invalid_credentials", "પાસવર્ડ ખોટો છે.", "Incorrect password.");
      }
      return cloudIssue(error, where);
    }
  }

  /** Let go of the open school at once: no backup flush, the lock released. */
  private async discardCurrent(): Promise<void> {
    const current = this.current;
    if (!current) return;
    this.backups?.detach();
    this.current = null;
    this.dataMissing = false;
    await current.prisma.$disconnect().catch(() => undefined);
    try {
      releaseLock(current.folder, this.device);
    } catch {
      // The drive is gone; its lock goes with it.
    }
  }

  private locate(profileId: string): FoundProfile | null {
    const known = this.known.get(profileId);
    const roots = this.options.roots?.() ?? mountedRoots(this.options.platform);
    return locateProfile(profileId, known?.folder ?? "", { platform: this.options.platform, roots });
  }

  private async keyFor(manifest: Manifest): Promise<string> {
    const account = this.account!;
    const cached = account.cachedKey(manifest.profileId);
    if (cached && keyMatches(manifest, cached)) return cached;
    if (cached) account.forgetKey(manifest.profileId);
    const key = await account.withSession((session) =>
      account.backend.getProfileKey(session, manifest.profileId),
    );
    if (!keyMatches(manifest, key)) {
      throw new VaultError("wrong-key", "the account's key does not match this folder's manifest");
    }
    account.rememberKey(manifest.profileId, key);
    return key;
  }

  /** Make a found, unlocked school folder the open one. */
  private async bind(found: FoundProfile, keyHex: string): Promise<void> {
    const file = booksFile(found.folder);
    // So the folder holding it is still recognised if the user renames it.
    if (isDataDir(path.dirname(found.folder))) markDataDir(path.dirname(found.folder));
    // A copy before anything - including a migration - touches the books.
    takeLocalBackup(found.folder, keyHex, "open");
    const migration = runMigrations(file, this.options.migrationsDir, { keyHex });
    const prisma = createPrismaClient({ file, keyHex });
    const year = await latestYear(prisma);
    const current: OpenSchool = {
      profileId: found.manifest.profileId,
      folder: found.folder,
      manifest: found.manifest,
      keyHex,
      prisma,
      setup: new SetupService(prisma),
      books: year ? new AccountsService(prisma, year.id, () => this.effectiveMode()) : null,
      yearLabel: year?.label ?? "",
      schemaVersion: migration.schemaVersion,
    };
    this.current = current;
    this.dataMissing = false;
    await this.refreshManifest(current);
    this.backups?.attach({
      folder: found.folder,
      profileId: current.profileId,
      keyHex,
      schemaVersion: migration.schemaVersion,
    });
  }

  /** Keep the manifest and this PC's list in step with the school's own record. */
  private async refreshManifest(current: OpenSchool): Promise<void> {
    const school = await current.prisma.school.findFirst();
    if (
      school &&
      (school.nameGu !== current.manifest.schoolNameGu || school.diseCode !== current.manifest.diseCode)
    ) {
      current.manifest = { ...current.manifest, schoolNameGu: school.nameGu, diseCode: school.diseCode };
      writeManifest(current.folder, current.manifest);
    }
    this.known.remember({
      profileId: current.profileId,
      ownerUserId: current.manifest.ownerUserId,
      schoolNameGu: current.manifest.schoolNameGu,
      diseCode: current.manifest.diseCode,
      appMode: this.modeForManifest(current.manifest),
      folder: current.folder,
      lastOpenedAt: new Date(this.now()).toISOString(),
    });
  }

  private async download(profileId: string, backupId: string): Promise<{ bytes: Uint8Array; backup: CloudBackup }> {
    const account = this.account!;
    const backups = await account.withSession((session) => account.backend.listBackups(session, profileId));
    const backup = backups.find((item) => item.id === backupId);
    if (!backup) throw new CloudError("not-found", "no such backup for this school");
    const bytes = await account.withSession((session) => account.backend.downloadBackup(session, backup));
    if (sha256(bytes) !== backup.sha256) throw new BackupDamagedError();
    return { bytes, backup };
  }

  private legacyBooks(): SchoolListDto["legacyBooks"] {
    const legacy = this.options.legacyBooks;
    if (!legacy || !isPlainDatabase(legacy.file)) return null;
    return { schoolNameGu: readLegacySchool(legacy.file)?.nameGu ?? null, developmentCopy: legacy.developmentCopy };
  }

  private async cloudCall<T>(call: (account: Account) => Promise<T>): Promise<ApiResult<T>> {
    const account = this.account;
    if (!account) return failure(ISSUES.unavailable());
    try {
      return { ok: true, data: await call(account) };
    } catch (error) {
      return failure(this.errorIssue(error, "cloud"));
    }
  }

  private errorIssue(error: unknown, where: string): Issue {
    if (error instanceof WrongModeError) return ISSUES.wrongMode(error.ownerMode);
    if (error instanceof CloudError) return cloudIssue(error, where);
    if (error instanceof NewerDataError) return ISSUES.newerData(error.message);
    if (error instanceof VaultError) return ISSUES.wrongKey(error.message);
    if (error instanceof BackupDamagedError) return ISSUES.backupDamaged();
    console.error(`${where} failed:`, error);
    return ISSUES.internal(error instanceof Error ? error.message : String(error));
  }
}

// ----------------------------------------------------------------- helpers

class WrongModeError extends Error {
  constructor(readonly ownerMode: AppMode) {
    super(`school belongs to ${ownerMode}`);
  }
}

class BackupDamagedError extends Error {
  constructor() {
    super("the downloaded backup does not match its checksum");
  }
}

async function latestYear(prisma: PrismaClient): Promise<{ id: number; label: string } | null> {
  // The newest year that is still open, so a school that switched to a closed
  // year to reprint it comes back to the one they are working in.
  return (
    (await prisma.financialYear.findFirst({ where: { status: "OPEN" }, orderBy: { label: "desc" } })) ??
    (await prisma.financialYear.findFirst({ orderBy: { label: "desc" } }))
  );
}

function profileAt(folder: string, profileId: string): FoundProfile | null {
  const manifest = readManifest(folder);
  return manifest && manifest.profileId === profileId ? { folder, manifest } : null;
}

/** A restored or downloaded file must open with the key and be an SMC database. */
function verifyBooks(file: string, keyHex: string): void {
  const database = openEncrypted(file, keyHex, { fileMustExist: true });
  try {
    const school = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='School'").get();
    if (!school) throw new VaultError("not-a-database", "the file is not an SMC Accounts database");
  } finally {
    database.close();
  }
}

function readLegacySchool(file: string): { nameGu: string; diseCode: string } | null {
  try {
    const database = new Database(file, { readonly: true, fileMustExist: true });
    try {
      return (database.prepare("SELECT nameGu, diseCode FROM School ORDER BY id LIMIT 1").get() ??
        null) as { nameGu: string; diseCode: string } | null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

/** Undo a school folder this attempt created - and "SMC Accounts" if it made that too and it is empty. */
function removeNewFolder(folder: string, removeParentIfEmpty: boolean): void {
  rmSync(folder, { recursive: true, force: true });
  if (removeParentIfEmpty) removeDataDirIfEmpty(path.dirname(folder));
}

/** A deleted school's folder, and the data folder too when nothing else is left in it. */
function removeSchoolFolder(folder: string): void {
  // Retries: Windows can take a moment to let go of a database just closed.
  rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  removeDataDirIfEmpty(path.dirname(folder));
}

function removeDataDirIfEmpty(dir: string): void {
  if (!isDataDir(dir)) return;
  try {
    const left = readdirSync(dir).filter((name) => name !== DATA_DIR_MARKER);
    if (left.length > 0) return;
    rmSync(path.join(dir, DATA_DIR_MARKER), { force: true });
    rmdirSync(dir);
  } catch {
    // Leave it.
  }
}

const deviceSchema = z.object({ id: z.string().uuid(), name: z.string() });
const modePreferenceSchema = z.object({
  remember: z.boolean(),
  savedMode: z.enum(APP_MODES).nullable(),
});
type ModePreference = z.infer<typeof modePreferenceSchema>;

function loadModePreference(userDataDir: string): ModePreference {
  const file = path.join(userDataDir, "mode.json");
  const stored = readJson(file, modePreferenceSchema);
  if (stored) {
    return stored.remember ? stored : { remember: false, savedMode: null };
  }
  return { remember: false, savedMode: null };
}

function saveModePreference(userDataDir: string, pref: ModePreference): void {
  const file = path.join(userDataDir, "mode.json");
  writeJsonAtomic(file, pref);
}

/** This PC's identity, for lock files and for naming who made a backup. */
function loadDevice(userDataDir: string): Device {
  const file = path.join(userDataDir, "device.json");
  const name = os.hostname() || "PC";
  const stored = readJson(file, deviceSchema);
  if (stored) {
    if (stored.name !== name) writeJsonAtomic(file, { id: stored.id, name });
    return { id: stored.id, name };
  }
  const device = { id: randomUUID(), name };
  writeJsonAtomic(file, device);
  return device;
}

function toBackupDto(backup: CloudBackup): CloudBackupDto {
  return {
    id: backup.id,
    createdAt: backup.createdAt,
    sizeBytes: backup.sizeBytes,
    deviceName: backup.deviceName,
    appVersion: backup.appVersion,
  };
}

function failure(issue: Issue): { ok: false; issues: Issue[] } {
  return { ok: false, issues: [issue] };
}

function issue(code: string, messageGu: string, messageEn: string, detail = messageEn): Issue {
  return { severity: "error", code, messageGu, messageEn, detail };
}

/** The same failure in the user's terms, whichever cloud call it came from. */
function cloudIssue(error: unknown, where: string): Issue {
  if (!(error instanceof CloudError)) {
    console.error(`${where} failed:`, error);
    return ISSUES.internal(error instanceof Error ? error.message : String(error));
  }
  const detail = `${where}: ${error.message}`;
  switch (error.code) {
    case "offline":
      return issue(
        "offline",
        "ઇન્ટરનેટ જોડાણ નથી. જોડાણ તપાસીને ફરી પ્રયત્ન કરો.",
        "No internet connection. Check the connection and try again.",
        detail,
      );
    case "invalid-credentials":
      return issue("invalid_credentials", "ઈમેલ અથવા પાસવર્ડ ખોટો છે.", "Wrong email or password.", detail);
    case "email-not-confirmed":
      return issue(
        "email_not_confirmed",
        "આ ઈમેલ હજી ચકાસાયો નથી. ઈમેલમાં આવેલો કોડ દાખલ કરો.",
        "This email is not confirmed yet. Enter the code that was emailed to it.",
        detail,
      );
    case "user-exists":
      return issue(
        "user_exists",
        "આ ઈમેલથી ખાતું પહેલેથી છે. લૉગિન કરો, અથવા પાસવર્ડ ભૂલી ગયા હો તો નવો બનાવો.",
        "An account already exists for this email. Log in, or reset the password.",
        detail,
      );
    case "invalid-code":
      return issue("invalid_code", "કોડ ખોટો છે અથવા તેની મુદત પૂરી થઈ ગઈ છે.", "The code is wrong or has expired.", detail);
    case "weak-password":
      return issue(
        "weak_password",
        "પાસવર્ડ ઓછામાં ઓછા 8 અક્ષરનો અને અનુમાન ન થઈ શકે તેવો રાખો.",
        "Use a password of at least 8 characters that is hard to guess.",
        detail,
      );
    case "rate-limited":
      return issue(
        "rate_limited",
        "ઘણા પ્રયત્નો થયા. થોડી મિનિટ પછી ફરી પ્રયત્ન કરો.",
        "Too many attempts. Try again in a few minutes.",
        detail,
      );
    case "session-expired":
      return issue("session_expired", "લૉગિનની મુદત પૂરી થઈ. ફરી લૉગિન કરો.", "Your login has ended. Please log in again.", detail);
    case "not-approved":
      return issue(
        "not_approved",
        "આ ખાતું હજુ મંજૂર થયું નથી. સોફ્ટવેર આપનારને આ ઈમેલ જણાવીને ખાતું મંજૂર કરાવો, પછી ફરી લૉગિન કરો.",
        "This account has not been approved yet. Ask the software's provider to approve this email, then log in again.",
        detail,
      );
    case "not-found":
      return issue(
        "not_found",
        "ક્લાઉડમાં આ માહિતી આ ખાતામાં મળી નહીં.",
        "This was not found in the cloud for this account.",
        detail,
      );
    case "needs-update":
      return issue(
        "cloud_needs_update",
        "ક્લાઉડમાં આ સુવિધા હજી ચાલુ થઈ નથી. સોફ્ટવેર આપનારને ક્લાઉડ અપડેટ (0003) ચલાવવા કહો.",
        "The cloud does not support this yet. Ask the software's provider to run the cloud update (0003).",
        detail,
      );
    case "server":
      return issue("cloud_error", "ક્લાઉડ સર્વરે ભૂલ બતાવી. થોડી વાર પછી ફરી પ્રયત્ન કરો.", "The cloud server reported an error. Try again later.", detail);
  }
}

const ISSUES = {
  notSignedIn: () => issue("not_signed_in", "પહેલાં લૉગિન કરો.", "Please log in first."),
  unavailable: () => issue("unavailable", "ક્લાઉડ સેટિંગ વગર આ સોફ્ટવેર ચાલી શકે નહીં.", "This build has no cloud settings."),
  noSchoolOpen: () => issue("no_school_open", "કોઈ શાળા ખુલ્લી નથી.", "No school is open."),
  notConnected: () =>
    issue(
      "not_connected",
      "આ શાળાનો ડેટા મળ્યો નહીં. પેન ડ્રાઈવ લગાવો અથવા ડેટાનું ફોલ્ડર પસંદ કરો.",
      "This school's data was not found. Insert the pen drive, or choose its folder.",
    ),
  otherAccount: () =>
    issue(
      "other_account",
      "આ ડેટા બીજા ખાતાનો છે. તે ખાતાથી લૉગિન કરીને ખોલો.",
      "This data belongs to another account. Log in with that account to open it.",
    ),
  wrongMode: (ownerMode: AppMode) => {
    const label = ownerMode === "smc-e-old" ? "SMC E old" : "SMC E";
    return issue(
      "wrong_mode",
      `આ શાળાનો ડેટા "${label}" મોડનો છે. તેને ખોલવા માટે પહેલાં મોડ બદલીને ${label} પસંદ કરો.`,
      `This school's data belongs to "${label}". Switch mode to ${label} first to open it.`,
    );
  },
  noSchoolInFolder: (folder: string) =>
    issue(
      "no_school_in_folder",
      "આ ફોલ્ડરમાં SMCE હિસાબનો કોઈ ડેટા નથી.",
      "There is no SMCE Accounts data in this folder.",
      `no profile.json in or just below ${folder}`,
    ),
  notWritable: (folder: string) =>
    issue(
      "folder_not_writable",
      "આ જગ્યાએ ડેટા સાચવી શકાતો નથી. બીજું ફોલ્ડર પસંદ કરો.",
      "Data cannot be saved here. Choose another folder.",
      `cannot write to ${folder}`,
    ),
  schoolExists: (diseCode: string) =>
    issue(
      "school_exists",
      `ડાયસ કોડ ${diseCode} ની શાળા આ ખાતામાં પહેલેથી છે. "હાલનો ડેટા ખોલો" વાપરો.`,
      `A school with DISE code ${diseCode} already exists in this account. Use "Open existing data".`,
    ),
  schoolAvailable: () =>
    issue(
      "school_available",
      "આ શાળાનો ડેટા આ PC પર મળે છે; તેને ખોલો. બીજી નકલ બનાવવાની જરૂર નથી.",
      "This school's data is reachable on this PC; open it instead of making a second copy.",
    ),
  noLegacyBooks: () => issue("no_legacy_books", "જૂનો ડેટા મળ્યો નહીં.", "No earlier books were found on this PC."),
  newerData: (detail: string) =>
    issue(
      "newer_data",
      "આ ડેટા SMCE હિસાબના નવા સંસ્કરણથી સાચવાયેલો છે. આ PC પર સોફ્ટવેર અપડેટ કરો.",
      "This data was saved by a newer version of SMCE Accounts. Update the software on this PC.",
      detail,
    ),
  wrongKey: (detail: string) =>
    issue(
      "wrong_key",
      "ડેટા ખોલી શકાયો નહીં: તે બગડેલો છે અથવા આ ખાતાની ચાવી સાથે મેળ ખાતો નથી.",
      "The data could not be opened: it is damaged, or does not match this account's key.",
      detail,
    ),
  backupDamaged: () =>
    issue(
      "backup_damaged",
      "ડાઉનલોડ થયેલો બેકઅપ બગડેલો છે, તેથી વાપર્યો નથી. ફરી પ્રયત્ન કરો.",
      "The downloaded backup was damaged, so it was not used. Try again.",
    ),
  folderNotRemoved: (folder: string, detail: string) =>
    issue(
      "folder_not_removed",
      `શાળા ખાતામાંથી કાઢી નાખી, પણ તેનું ફોલ્ડર કાઢી શકાયું નહીં: ${folder}. તેને હાથેથી કાઢી નાખો.`,
      `The school was deleted from the account, but its folder could not be removed: ${folder}. Delete it by hand.`,
      detail,
    ),
  badFolderName: (name: string) =>
    issue(
      "bad_folder_name",
      'ફોલ્ડરનું નામ ખાલી ન રાખો અને તેમાં \\ / : * ? " < > | જેવા ચિહ્નો ન વાપરો.',
      'Give the folder a name, without characters such as \\ / : * ? " < > |.',
      `not a usable folder name: ${JSON.stringify(name)}`,
    ),
  folderAtDriveRoot: () =>
    issue(
      "folder_at_drive_root",
      "આ શાળાનો ડેટા સીધો ડ્રાઈવમાં છે, તેથી બદલવા માટે કોઈ ફોલ્ડર નથી.",
      "This school's data is directly on the drive, so there is no folder to rename.",
    ),
  folderExists: (target: string) =>
    issue("folder_exists", `આ નામનું ફોલ્ડર પહેલેથી છે: ${target}`, `A folder with this name already exists: ${target}`),
  folderInUse: (schoolNameGu: string, deviceName: string) =>
    issue(
      "folder_in_use",
      `${schoolNameGu} હાલ બીજા PC (${deviceName}) પર ખુલ્લી છે. ત્યાં બંધ કરીને ફરી પ્રયત્ન કરો.`,
      `${schoolNameGu} is open on another PC (${deviceName}). Close it there and try again.`,
    ),
  renameFailed: (folder: string, detail: string) =>
    issue(
      "rename_failed",
      `ફોલ્ડરનું નામ બદલી શકાયું નહીં: ${folder}. તેમાંની કોઈ ફાઈલ બીજા પ્રોગ્રામમાં ખુલ્લી હોઈ શકે.`,
      `The folder could not be renamed: ${folder}. A file in it may be open in another program.`,
      detail,
    ),
  internal: (detail: string) =>
    issue("internal_error", "અણધારી ભૂલ આવી. વિગત માટે લોગ જુઓ.", "Something went wrong. See the log for details.", detail),
};
