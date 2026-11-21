import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { api } from "../api.js";
import { endSuggestionSession } from "../suggestions/sync.js";
import {
  APP_MODES,
  type AppMode,
  type AppModeStateDto,
  type AppStateDto,
  type CloudBackupDto,
  type CloudInfoDto,
  type FolderInspectionDto,
  type SchoolListDto,
  type SchoolListItemDto,
  type UserDto,
} from "../../shared/api.js";
import type { Issue } from "../../engine/validation.js";
import { IssueList } from "../components/IssueList.js";
import { Modal } from "../components/Modal.js";
import { Popover } from "../components/Popover.js";
import { LanguageSwitch } from "../components/LanguageSwitch.js";
import { ModeSwitcher } from "../components/ModeSwitcher.js";
import { formatBytes, formatDateTime, modeLabel } from "../format.js";
import { useStrings } from "../i18n/index.js";

/**
 * Choosing a school - Tally's "Select Company".
 *
 * Every school in the account is listed, with where its data is from this PC's
 * point of view:
 *
 *   available            its folder is reachable: open it
 *   pen drive not in     this PC knows it; plug the drive in, or point at the folder
 *   never on this PC     open its folder from a pen drive, or bring it back
 *                        from a cloud backup if the pen drive is gone
 */
interface LockPrompt {
  profileId: string;
  folder?: string;
  deviceName: string;
  openedAt: string;
}

interface RestorePanel {
  school: SchoolListItemDto;
  backups: CloudBackupDto[] | null;
  chosen: string | null;
}

/**
 * Prompts the user to pick "SMC E" or "SMC E old" after sign-in (and on launch
 * when "Remember selected mode" is off).
 */
export function ModeSelect({
  user,
  modeState,
  onSelected,
  onSignedOut,
}: {
  user: UserDto;
  modeState: AppModeStateDto;
  onSelected: (next: AppStateDto) => void;
  onSignedOut: () => void;
}): JSX.Element {
  const t = useStrings();
  const [busyMode, setBusyMode] = useState<AppMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(mode: AppMode): Promise<void> {
    setBusyMode(mode);
    setError(null);
    try {
      const next = await api.setAppMode(mode);
      onSelected(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setBusyMode(null);
    }
  }

  async function signOut(): Promise<void> {
    setBusyMode("smc-e");
    try {
      await endSuggestionSession();
      await api.signOut();
      onSignedOut();
    } finally {
      setBusyMode(null);
    }
  }

  const meta: Record<AppMode, { title: string; hint: string; badgeClass: string }> = {
    "smc-e": { title: t.modeSmcE, hint: t.modeSmcEHint, badgeClass: "smc-e" },
    "smc-e-old": { title: t.modeSmcEOld, hint: t.modeSmcEOldHint, badgeClass: "smc-e-old" },
    smc: { title: t.modeSmc, hint: t.modeSmcHint, badgeClass: "smc" },
  };

  return (
    <div className="setup">
      <div className="setup-form">
        <header className="setup-head">
          <div>
            <h1>{t.modeSelectTitle}</h1>
            <p>{t.modeSelectSubtitle}</p>
            <p className="muted num-inline">{t.schoolsSignedInAs(user.email)}</p>
          </div>
          <div className="schools-head-actions">
            <LanguageSwitch />
            <button
              type="button"
              className="ghost"
              onClick={() => void signOut()}
              disabled={busyMode !== null}
            >
              {t.schoolsSignOut}
            </button>
          </div>
        </header>

        {error !== null && (
          <div className="issue error" style={{ marginBottom: 16 }}>
            <div>{error}</div>
          </div>
        )}

        <div className="mode-grid">
          {APP_MODES.map((option) => {
            const info = meta[option];
            const isSaved = modeState.savedMode === option;
            return (
              <button
                key={option}
                type="button"
                className={`mode-card${isSaved ? " saved" : ""}`}
                disabled={busyMode !== null}
                onClick={() => void choose(option)}
              >
                <div className="mode-card-head">
                  <span className={`mode-badge ${info.badgeClass}`}>{info.title}</span>
                  <span className="mode-card-cta">
                    {busyMode === option ? t.working : t.modeOpenButton} →
                  </span>
                </div>
                <p className="muted">{info.hint}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function Schools({
  user,
  cloud,
  modeState,
  onOpened,
  onNewSchool,
  onModeChanged,
}: {
  user: UserDto;
  cloud: CloudInfoDto;
  modeState?: AppModeStateDto;
  onOpened: () => void;
  onNewSchool: () => void;
  onModeChanged?: (next: AppStateDto) => void;
}): JSX.Element {
  const t = useStrings();
  const [list, setList] = useState<SchoolListDto | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [lock, setLock] = useState<LockPrompt | null>(null);
  const [found, setFound] = useState<FolderInspectionDto | null>(null);
  const [restore, setRestore] = useState<RestorePanel | null>(null);
  const [deleting, setDeleting] = useState<{ school: SchoolListItemDto; password: string } | null>(null);
  const [deletedNotice, setDeletedNotice] = useState<string[] | null>(null);
  const [query, setQuery] = useState("");
  const page = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setList(await api.listSchools());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Close whichever window is open; its messages go with it. */
  function closeWindow(): void {
    setLock(null);
    setDeleting(null);
    setRestore(null);
    setIssues([]);
  }

  // A message or a found folder shows at the top of the page: bring it into view.
  const atTop = (issues.length > 0 && restore === null && deleting === null && lock === null) || found !== null;
  useEffect(() => {
    if (atTop) page.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [atTop, issues, found]);

  async function busyWith(work: () => Promise<void>): Promise<void> {
    setBusy(true);
    setIssues([]);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  function open(profileId: string, options: { folder?: string; force?: boolean } = {}): Promise<void> {
    return busyWith(async () => {
      const result = await api.openSchool(profileId, options);
      if (!result.ok) {
        setIssues(result.issues);
        await load();
        return;
      }
      if (!result.data.opened) {
        setLock({ profileId, folder: options.folder, ...result.data.lockedBy });
        return;
      }
      setLock(null);
      onOpened();
    });
  }

  /** Point at a folder or pen drive and open what is in it. */
  function openFromFolder(expected?: SchoolListItemDto): Promise<void> {
    return busyWith(async () => {
      setFound(null);
      const folder = await api.pickFolder("openSchool");
      if (!folder) return;
      const inspected = await api.inspectFolder(folder);
      if (!inspected.ok) {
        setIssues(inspected.issues);
        return;
      }
      const mine = inspected.data.schools.filter((school) => school.ownedByMe);
      const match = expected
        ? mine.find((school) => school.profileId === expected.profileId)
        : mine.length === 1 && inspected.data.schools.length === 1
          ? mine[0]
          : undefined;
      if (match) {
        setBusy(false);
        await open(match.profileId, { folder: match.folder });
        return;
      }
      setFound(inspected.data);
    });
  }

  function showRestore(school: SchoolListItemDto): Promise<void> {
    return busyWith(async () => {
      setRestore({ school, backups: null, chosen: null });
      const result = await api.listCloudBackups(school.profileId);
      if (!result.ok) {
        // Stay in the window, with the reason in it.
        setIssues(result.issues);
        setRestore({ school, backups: [], chosen: null });
        return;
      }
      setRestore({ school, backups: result.data, chosen: result.data[0]?.id ?? null });
    });
  }

  function restoreTo(): Promise<void> {
    const panel = restore;
    if (!panel?.chosen) return Promise.resolve();
    return busyWith(async () => {
      const folder = await api.pickFolder("restoreSchool");
      if (!folder) return;
      const result = await api.restoreSchool(panel.school.profileId, panel.chosen!, folder);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      onOpened();
    });
  }

  function moveLegacy(): Promise<void> {
    return busyWith(async () => {
      const folder = await api.pickFolder("newSchool");
      if (!folder) return;
      const result = await api.moveLegacyBooks(folder);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      onOpened();
    });
  }

  /** The whole school, gone: the account password first, then the cloud, then its folder. */
  function deleteSchool(): Promise<void> {
    const panel = deleting;
    if (!panel) return Promise.resolve();
    return busyWith(async () => {
      setDeletedNotice(null);
      const result = await api.deleteSchool(panel.school.profileId, panel.password);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setDeleting(null);
      setList(result.data.list);
      setDeletedNotice([
        t.schoolDeleted(panel.school.schoolNameGu),
        result.data.folderRemoved ? t.schoolDeletedFolder(result.data.folderRemoved) : t.schoolDeletedNoFolder,
      ]);
    });
  }

  async function signOut(): Promise<void> {
    await endSuggestionSession();
    await api.signOut();
    onOpened();
  }

  const activeMode = modeState?.active ?? null;

  async function switchMode(nextMode: AppMode): Promise<void> {
    if (!activeMode || !onModeChanged || busy || nextMode === activeMode) return;
    setBusy(true);
    try {
      await endSuggestionSession();
      const next = await api.setAppMode(nextMode);
      onModeChanged(next);
    } finally {
      setBusy(false);
    }
  }

  const availability: Record<SchoolListItemDto["availability"], string> = {
    ready: t.schoolsReady,
    notConnected: t.schoolsNotConnected,
    notOnThisPc: t.schoolsNotOnThisPc,
  };

  const needle = query.trim().toLowerCase();
  const shown =
    list?.schools.filter(
      (school) =>
        needle === "" || school.schoolNameGu.toLowerCase().includes(needle) || school.diseCode.toLowerCase().includes(needle),
    ) ?? [];
  // Errors from a window show in it; others at the top of the page, scrolled to.
  const windowOpen = restore !== null || deleting !== null || lock !== null;

  return (
    <div className="setup" ref={page}>
      <div className="setup-form schools-page">
        <header className="setup-head">
          <div>
            <h1>{t.schoolsTitle}</h1>
            <p>{t.schoolsSubtitle}</p>
            <p className="muted num-inline">{t.schoolsSignedInAs(user.email)}</p>
          </div>
          <div className="schools-head-actions">
            {activeMode && (
              <ModeSwitcher active={activeMode} disabled={busy || !onModeChanged} onSelect={switchMode} />
            )}
            <LanguageSwitch />
            <button type="button" className="ghost" onClick={() => void signOut()} disabled={busy}>
              {t.schoolsSignOut}
            </button>
          </div>
        </header>

        {cloud.kind === "fake" && cloud.note && (
          <div className="issue warning">
            <div>
              <strong>{t.authDevCloud}.</strong> {cloud.note}
            </div>
          </div>
        )}

        {issues.length > 0 && !windowOpen && (
          <div className="card">
            <IssueList issues={issues} />
          </div>
        )}

        {deletedNotice && (
          <div className="issue success">
            <div>
              {deletedNotice.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        )}

        <div className="schools-actions">
          <button className="school-action" type="button" onClick={onNewSchool} disabled={busy} title={t.schoolsNewHint}>
            <span className="school-action-icon" aria-hidden="true">＋</span>
            <span>
              <strong>{t.schoolsNew}</strong>
              <span className="muted">{t.schoolsNewHint}</span>
            </span>
          </button>
          <button
            className="school-action"
            type="button"
            onClick={() => void openFromFolder()}
            disabled={busy}
            title={t.schoolsOpenExistingHint}
          >
            <span className="school-action-icon" aria-hidden="true">📂</span>
            <span>
              <strong>{t.schoolsOpenExisting}</strong>
              <span className="muted">{t.schoolsOpenExistingHint}</span>
            </span>
          </button>
        </div>

        {found && (
          <div className="card">
            <p>{t.schoolsFoundInFolder}</p>
            {found.schools.map((school) => (
              <div className="school-row" key={school.profileId + school.folder}>
                <div>
                  <div className="school-name">{school.schoolNameGu}</div>
                  <div className="muted num-inline">
                    {school.diseCode} · {school.folder}
                  </div>
                </div>
                {!school.ownedByMe ? (
                  <span className="badge muted">{t.schoolsOtherAccount}</span>
                ) : activeMode && school.appMode !== activeMode ? (
                  <span className="badge muted">{t.schoolsWrongMode(modeLabel(school.appMode, t))}</span>
                ) : (
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => void open(school.profileId, { folder: school.folder })}
                  >
                    {t.schoolsOpen}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {list?.legacyBooks && (
          <div className="card legacy-card">
            <h3>{t.legacyTitle}</h3>
            <p>
              {list.legacyBooks.schoolNameGu && <strong>{list.legacyBooks.schoolNameGu}. </strong>}
              {t.legacyHint}
              {list.legacyBooks.developmentCopy && <span className="muted"> {t.legacyDevNote}</span>}
            </p>
            <button className="primary" type="button" disabled={busy} onClick={() => void moveLegacy()}>
              {t.legacyMove}
            </button>
          </div>
        )}

        {list && !list.cloudReachable && (
          <div className="issue warning">
            <div>
              {t.schoolsOffline}{" "}
              <button className="link" type="button" onClick={() => void load()}>
                {t.schoolsRefresh}
              </button>
            </div>
          </div>
        )}

        {list && list.schools.length > SEARCH_FROM && (
          <div className="schools-toolbar">
            <input
              type="search"
              className="schools-search"
              placeholder={t.schoolsSearch}
              aria-label={t.schoolsSearch}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <span className="muted num-inline">{t.schoolsCount(shown.length, list.schools.length)}</span>
          </div>
        )}

        {list === null && <p className="muted">{t.loading}</p>}
        {list && list.schools.length === 0 && <div className="card muted">{t.schoolsEmpty}</div>}
        {list && list.schools.length > 0 && shown.length === 0 && <p className="muted">{t.schoolsNoMatch}</p>}

        <div className="school-grid">
          {shown.map((school) => (
            <SchoolCard
              key={school.profileId}
              school={school}
              status={availability[school.availability]}
              busy={busy}
              onOpen={() => void open(school.profileId)}
              onFindFolder={() => void openFromFolder(school)}
              onRestore={() => void showRestore(school)}
              onForget={async () => setList(await api.forgetSchool(school.profileId))}
              onDelete={() => {
                setIssues([]);
                setDeletedNotice(null);
                setDeleting({ school, password: "" });
              }}
            />
          ))}
        </div>
      </div>

      {lock && (
        <Modal title={t.schoolsOpenAnyway} busy={busy} onClose={closeWindow}>
          <p>{t.schoolsLocked(lock.deviceName, formatDateTime(lock.openedAt))}</p>
          {issues.length > 0 && <IssueList issues={issues} />}
          <div className="form-actions">
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() => void open(lock.profileId, { folder: lock.folder, force: true })}
            >
              {t.schoolsOpenAnyway}
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={closeWindow}>
              {t.cancel}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal title={t.schoolDeleteTitle(deleting.school.schoolNameGu)} busy={busy} onClose={closeWindow}>
          <form
            className="delete-school-card"
            onSubmit={(event) => {
              event.preventDefault();
              void deleteSchool();
            }}
          >
            <div className="issue error">
              <div>{t.schoolDeleteWarning}</div>
            </div>
            {issues.length > 0 && <IssueList issues={issues} />}
            <div className="field">
              <label htmlFor="delete-school-password">{t.schoolDeletePassword}</label>
              <input
                id="delete-school-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={deleting.password}
                onChange={(event) => setDeleting({ ...deleting, password: event.target.value })}
              />
            </div>
            <div className="form-actions">
              <button className="danger" type="submit" disabled={busy || deleting.password.trim() === ""}>
                {busy ? t.working : t.schoolDeleteConfirm}
              </button>
              <button className="ghost" type="button" disabled={busy} onClick={closeWindow}>
                {t.cancel}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {restore && (
        <Modal title={t.restoreTitle(restore.school.schoolNameGu)} busy={busy} wide onClose={closeWindow}>
          <p className="muted">{t.restoreHint}</p>
          {issues.length > 0 && <IssueList issues={issues} />}
          {restore.backups === null && <p className="muted">{t.loading}</p>}
          {restore.backups?.length === 0 && issues.length === 0 && <p className="muted">{t.restoreNoBackups}</p>}
          {restore.backups && restore.backups.length > 0 && (
            <div className="modal-scroll">
              <BackupPicker
                backups={restore.backups}
                chosen={restore.chosen}
                onChoose={(id) => setRestore({ ...restore, chosen: id })}
              />
            </div>
          )}
          <div className="form-actions">
            <button className="primary" type="button" disabled={busy || !restore.chosen} onClick={() => void restoreTo()}>
              {busy && restore.backups !== null ? t.working : t.restoreChooseLocation}
            </button>
            <button className="ghost" type="button" disabled={busy} onClick={closeWindow}>
              {t.cancel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Search appears once the list is longer than this. */
const SEARCH_FROM = 6;

/**
 * One school, compact: name and status on one line, DISE code and when it was
 * last opened under it; the one thing to do now as a button, the rest in a menu.
 */
function SchoolCard({
  school,
  status,
  busy,
  onOpen,
  onFindFolder,
  onRestore,
  onForget,
  onDelete,
}: {
  school: SchoolListItemDto;
  status: string;
  busy: boolean;
  onOpen: () => void;
  onFindFolder: () => void;
  onRestore: () => void;
  onForget: () => void;
  onDelete: () => void;
}): JSX.Element {
  const t = useStrings();
  const [menu, setMenu] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const ready = school.availability === "ready";
  // Never opened here: bringing it back from the cloud is the likely step. Drive
  // not plugged in: point at its folder.
  const kind: "open" | "restore" | "folder" = ready ? "open" : school.availability === "notOnThisPc" ? "restore" : "folder";
  const main =
    kind === "open"
      ? { label: t.schoolsOpen, run: onOpen }
      : kind === "restore"
        ? { label: t.schoolsRestore, run: onRestore }
        : { label: t.schoolsFindFolder, run: onFindFolder };
  const items: { label: string; run: () => void; danger?: boolean }[] = [
    ...(kind === "restore" ? [{ label: t.schoolsFindFolder, run: onFindFolder }] : []),
    ...(kind === "folder" ? [{ label: t.schoolsRestore, run: onRestore }] : []),
    ...(school.availability === "notConnected" ? [{ label: t.schoolsForget, run: onForget }] : []),
    { label: t.schoolDelete, run: onDelete, danger: true },
  ];
  const where = [
    school.diseCode,
    school.lastOpenedAt ? `${t.schoolsLastOpened} ${formatDateTime(school.lastOpenedAt)}` : null,
  ].filter(Boolean);

  return (
    <div className={`school-card ${school.availability}`} title={school.folder ?? undefined}>
      <div className="school-card-text">
        <div className="school-card-name">
          <span className={`status-dot ${school.availability}`} title={status} aria-label={status} />
          <span className="school-name">{school.schoolNameGu}</span>
        </div>
        <div className="muted num-inline school-card-meta">
          {where.join(" · ")}
          {!ready && <span className={`school-card-status ${school.availability}`}> · {status}</span>}
        </div>
      </div>
      <div className="school-card-actions">
        <button className={ready ? "primary" : "ghost"} type="button" disabled={busy} onClick={main.run}>
          {main.label}
        </button>
        <button
          ref={more}
          type="button"
          className="ghost school-card-more"
          aria-label={t.schoolsMore}
          title={t.schoolsMore}
          aria-haspopup="menu"
          aria-expanded={menu}
          disabled={busy}
          onClick={() => setMenu(!menu)}
        >
          ⋯
        </button>
        {menu && (
          <Popover anchor={more} onClose={() => setMenu(false)} className="school-card-menu" role="menu">
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={item.danger ? "danger-text" : undefined}
                onClick={() => {
                  setMenu(false);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </Popover>
        )}
      </div>
    </div>
  );
}

/** A table of cloud backups, newest first, one of them chosen. */
export function BackupPicker({
  backups,
  chosen,
  onChoose,
}: {
  backups: CloudBackupDto[];
  chosen: string | null;
  onChoose: (id: string) => void;
}): JSX.Element {
  const t = useStrings();
  return (
    <table>
      <thead>
        <tr>
          <th />
          <th>{t.backupWhen}</th>
          <th>{t.backupDevice}</th>
          <th className="num">{t.backupSize}</th>
        </tr>
      </thead>
      <tbody>
        {backups.map((backup, index) => (
          <tr key={backup.id} onClick={() => onChoose(backup.id)} className="clickable">
            <td style={{ width: 32 }}>
              <input
                type="radio"
                name="backup"
                checked={chosen === backup.id}
                onChange={() => onChoose(backup.id)}
                aria-label={formatDateTime(backup.createdAt)}
              />
            </td>
            <td className="num-inline">
              {formatDateTime(backup.createdAt)}
              {index === 0 && <span className="badge ready"> {t.restoreLatest}</span>}
            </td>
            <td className="num-inline">{backup.deviceName}</td>
            <td className="num">{formatBytes(backup.sizeBytes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
