import { useState } from "react";
import type { JSX } from "react";
import { api } from "../api.js";
import { endSuggestionSession } from "../suggestions/sync.js";
import {
  APP_MODES,
  type AppMode,
  type AppModeStateDto,
  type AppStateDto,
  type CloudBackupDto,
  type DashboardDto,
  type OpenSchoolDto,
  type UserDto,
} from "../../shared/api.js";
import type { Issue } from "../../engine/validation.js";
import { LANGUAGES, useLanguage, useStrings, type Language } from "../i18n/index.js";
import { backupLabel, useBackupStatus } from "../components/BackupBadge.js";
import { IssueList } from "../components/IssueList.js";
import { BackupPicker } from "./Schools.js";
import { formatDateTime } from "../format.js";
import { askConfirm } from "../components/ConfirmDialog.js";

/**
 * Application preferences, and the open school's account and backups.
 *
 * The interface language is the only preference. The printed reports are
 * deliberately not affected — they are the government audit forms and must
 * stay Gujarati, which the screen says out loud so nobody goes looking for a
 * setting that should not exist.
 */
export function Settings({
  data,
  school,
  user,
  modeState,
  onModeChanged,
  onSignedOut,
}: {
  data: DashboardDto;
  school: OpenSchoolDto;
  user: UserDto;
  modeState: AppModeStateDto;
  onModeChanged: (next: AppStateDto) => void;
  onSignedOut: () => void;
}): JSX.Element {
  const t = useStrings();
  const { language, setLanguage } = useLanguage();
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const activeMode: AppMode = modeState.active ?? "smc-e";

  const labelFor: Record<Language, string> = {
    gu: t.languageGujarati,
    en: t.languageEnglish,
  };

  const modeMeta: Record<AppMode, { label: string; hint: string }> = {
    "smc-e": { label: t.modeSmcE, hint: t.modeSmcEHint },
    "smc-e-old": { label: t.modeSmcEOld, hint: t.modeSmcEOldHint },
    smc: { label: t.modeSmc, hint: t.modeSmcHint },
  };

  async function changeMode(mode: AppMode): Promise<void> {
    if (modeBusy || mode === activeMode) return;
    setModeBusy(true);
    setModeError(null);
    try {
      await endSuggestionSession();
      const next = await api.setAppMode(mode);
      onModeChanged(next);
    } catch (cause) {
      setModeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModeBusy(false);
    }
  }

  async function toggleRemember(remember: boolean): Promise<void> {
    if (modeBusy) return;
    setModeBusy(true);
    setModeError(null);
    try {
      const next = await api.setModeRemember(remember);
      onModeChanged(next);
    } catch (cause) {
      setModeError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setModeBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{t.settingsTitle}</h2>
          <p>{t.settingsSubtitle}</p>
        </div>
      </div>

      <div className="card">
        <h3>{t.language}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {t.languageHelp}
        </p>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {LANGUAGES.map((option) => (
            <button
              key={option}
              className={language === option ? "primary" : "ghost"}
              aria-pressed={language === option}
              onClick={() => setLanguage(option)}
              style={{ minWidth: 170 }}
            >
              {labelFor[option]}
            </button>
          ))}
        </div>

        <div className="issue warning" style={{ marginTop: 16 }}>
          <div>{t.reportsAlwaysGujarati}</div>
        </div>
      </div>

      <div className="card">
        <h3>{t.modeSection}</h3>
        <p className="muted" style={{ marginTop: 4 }}>
          {t.modeSectionHelp}
        </p>

        {modeError !== null && (
          <div className="issue error" style={{ marginTop: 12 }}>
            <div>{modeError}</div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          {APP_MODES.map((option) => (
            <button
              key={option}
              type="button"
              className={activeMode === option ? "primary" : "ghost"}
              aria-pressed={activeMode === option}
              disabled={modeBusy}
              onClick={() => void changeMode(option)}
              style={{ minWidth: 170 }}
            >
              {modeMeta[option].label}
            </button>
          ))}
        </div>

        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {modeMeta[activeMode].hint}
        </p>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginTop: 16,
            cursor: modeBusy ? "default" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={modeState.remember}
            disabled={modeBusy}
            onChange={(event) => void toggleRemember(event.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>{t.modeRememberLabel}</strong>
            <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 2 }}>
              {t.modeRememberHelp}
            </span>
          </span>
        </label>
      </div>

      <AccountAndBackup school={school} user={user} onSignedOut={onSignedOut} />

      <div className="card">
        <h3>{t.aboutTitle}</h3>
        <table>
          <tbody>
            <tr>
              <td style={{ width: 220 }}>{t.aboutSchool}</td>
              <td>
                {data.school.nameGu}
                <div className="muted" style={{ fontSize: 13 }}>
                  {t.diseCode} {data.school.diseCode} · {data.school.clusterGu} ·{" "}
                  {data.school.talukaGu}
                </div>
              </td>
            </tr>
            <tr>
              <td>{t.aboutBank}</td>
              <td>
                {data.school.bankNameGu} {data.school.bankBranchGu}
                <div className="muted num" style={{ fontSize: 13 }}>
                  {data.school.bankAccountNo}
                </div>
              </td>
            </tr>
            <tr>
              <td>{t.year}</td>
              <td className="num">{data.year.label}</td>
            </tr>
            <tr>
              <td>{t.navReports}</td>
              <td>{t.reportFontNote}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * Who is signed in, where this school's data is, and its cloud backups.
 *
 * Restoring replaces the open books with an older backup, so it asks first; the
 * books it replaces are kept in the school's backups folder either way.
 */
function AccountAndBackup({
  school,
  user,
  onSignedOut,
}: {
  school: OpenSchoolDto;
  user: UserDto;
  onSignedOut: () => void;
}): JSX.Element {
  const t = useStrings();
  const status = useBackupStatus(3000);
  const [backups, setBackups] = useState<CloudBackupDto[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The new name being typed for the data folder; null while not renaming.
  const [folderName, setFolderName] = useState<string | null>(null);

  async function work(task: () => Promise<void>): Promise<void> {
    setBusy(true);
    setIssues([]);
    setMessage(null);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  }

  const backupNow = () =>
    work(async () => {
      const result = await api.backupNow();
      if (!result.ok) setIssues(result.issues);
      if (backups) await showBackups();
    });

  const showBackups = async (): Promise<void> => {
    const result = await api.listCloudBackups(school.profileId);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setBackups(result.data);
    setChosen(result.data[0]?.id ?? null);
  };

  const restore = () =>
    work(async () => {
      const backup = backups?.find((item) => item.id === chosen);
      if (!backup) return;
      if (!(await askConfirm(t.backupRestoreConfirm(formatDateTime(backup.createdAt))))) return;
      const result = await api.restoreBackup(backup.id);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setMessage(t.backupRestored);
      // Every screen holds figures from the books that were just replaced.
      window.location.reload();
    });

  const renameFolder = () =>
    work(async () => {
      if (folderName === null) return;
      const result = await api.renameDataFolder(folderName);
      if (!result.ok) {
        setIssues(result.issues);
        return;
      }
      setFolderName(null);
      if (result.data.phase === "open") setMessage(t.renameDataFolderDone(result.data.school.folder));
      // The school was closed and reopened from its new place: show that place.
      onSignedOut();
    });

  const signOut = () =>
    work(async () => {
      if (!(await askConfirm(t.signOutHint))) return;
      await endSuggestionSession();
      await api.signOut();
      onSignedOut();
    });

  return (
    <div className="card">
      <h3>{t.accountSection}</h3>
      {issues.length > 0 && <IssueList issues={issues} />}
      {message && <div className="issue warning">{message}</div>}
      <table>
        <tbody>
          <tr>
            <td style={{ width: 220 }}>{t.accountEmail}</td>
            <td>
              <span className="num-inline">{user.email}</span>{" "}
              <button className="ghost small" type="button" disabled={busy} onClick={() => void signOut()}>
                {t.schoolsSignOut}
              </button>
            </td>
          </tr>
          <tr>
            <td>{t.dataFolder}</td>
            <td>
              <span className="num-inline">{school.folder}</span>{" "}
              <button className="ghost small" type="button" onClick={() => void api.showDataFolder()}>
                {t.openDataFolder}
              </button>{" "}
              {folderName === null && (
                <button
                  className="ghost small"
                  type="button"
                  disabled={busy}
                  onClick={() => setFolderName(dataFolderName(school.folder))}
                >
                  {t.renameDataFolder}
                </button>
              )}
              {folderName !== null && (
                <form
                  className="rename-folder"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void renameFolder();
                  }}
                >
                  <div className="field">
                    <label htmlFor="data-folder-name">{t.renameDataFolderLabel}</label>
                    <input
                      id="data-folder-name"
                      autoFocus
                      value={folderName}
                      onChange={(event) => setFolderName(event.target.value)}
                    />
                  </div>
                  <button className="primary small" type="submit" disabled={busy || folderName.trim() === ""}>
                    {busy ? t.working : t.renameDataFolderSave}
                  </button>
                  <button className="ghost small" type="button" disabled={busy} onClick={() => setFolderName(null)}>
                    {t.cancel}
                  </button>
                  <div className="muted" style={{ fontSize: 13, flexBasis: "100%" }}>
                    {t.renameDataFolderHint}
                  </div>
                </form>
              )}
              <div className="muted" style={{ fontSize: 13 }}>
                {t.encryptionNote}
              </div>
            </td>
          </tr>
          <tr>
            <td>{t.backupStatus}</td>
            <td>
              {status && <span className={`backup-badge ${status.state}`}>{backupLabel(status, t)}</span>}{" "}
              <button className="primary small" type="button" disabled={busy} onClick={() => void backupNow()}>
                {busy ? t.working : t.backupNow}
              </button>
              {status?.lastError && status.state !== "upToDate" && (
                <div className="muted num-inline" style={{ fontSize: 12 }}>
                  {status.lastError}
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <h4 style={{ marginBottom: 4 }}>{t.backupList}</h4>
      <p className="muted" style={{ marginTop: 0 }}>
        {t.backupListHint}
      </p>
      {backups === null ? (
        <button className="ghost" type="button" disabled={busy} onClick={() => void work(showBackups)}>
          {t.backupShowList}
        </button>
      ) : backups.length === 0 ? (
        <p className="muted">{t.restoreNoBackups}</p>
      ) : (
        <>
          <BackupPicker backups={backups} chosen={chosen} onChoose={setChosen} />
          <div className="form-actions">
            <button className="danger" type="button" disabled={busy || !chosen} onClick={() => void restore()}>
              {t.backupRestore}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** "SMC Accounts" in F:\SMC Accounts\24160203401: the folder that holds the school's own. */
function dataFolderName(schoolFolder: string): string {
  const parts = schoolFolder.split(/[\\/]+/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2]! : "";
}
