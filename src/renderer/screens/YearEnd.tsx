import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { JSX } from "react";
import { api } from "../api.js";
import type { FinancialYearDto, YearEndPreviewDto } from "../../shared/api.js";
import type { Issue } from "../../engine/validation.js";
import { IssueList } from "../components/IssueList.js";
import { Money } from "../components/Money.js";
import { amountToInput, formatDate, tryParseAmount } from "../format.js";
import { isEarlierYear } from "../../lib/dates.js";
import { useStrings } from "../i18n/index.js";
import { askConfirm } from "../components/ConfirmDialog.js";

/**
 * Year closing, and switching between years.
 *
 * Closing is the only action in the app that creates a second year of books, and
 * it is not undoable from any screen, so the whole thing is shown before it
 * happens: every head's closing balance, which becomes next year's opening
 * balance, and anything standing in the way.
 *
 * The refusals come from the service, not from here - a web build would get the
 * same ones. This screen's job is to show them in the school's language and to
 * make the consequence visible before the button is pressed.
 */
export function YearEnd(): JSX.Element {
  const t = useStrings();
  const [preview, setPreview] = useState<YearEndPreviewDto | null>(null);
  const [years, setYears] = useState<FinancialYearDto[]>([]);
  const [nextLabel, setNextLabel] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  // Next year's opening per head, as typed; starts as this year's closing.
  const [openings, setOpenings] = useState<Record<number, string>>({});
  // An older year's opening per head, as typed; starts empty (zero).
  const [olderOpenings, setOlderOpenings] = useState<Record<number, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<FinancialYearDto | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameLabel, setRenameLabel] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [nextPreview, nextYears] = await Promise.all([
          api.getYearEndPreview(),
          api.listFinancialYears(),
        ]);
        setPreview(nextPreview);
        setYears(nextYears);
        setNextLabel(nextPreview.suggestedNextLabel);
        setOpenings(
          Object.fromEntries(nextPreview.rows.map((row) => [row.grantHeadId, amountToInput(row.closingPaise)])),
        );
      } catch (cause) {
        setFailure(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (failure !== null) {
    return (
      <div className="state error">
        <p>{t.couldNotLoad}</p>
        <p className="num">{failure}</p>
      </div>
    );
  }

  if (loading || !preview) return <div className="state">{t.calculating}</div>;

  // A year older than this one opens with what the school types, not with this
  // year's બંધ સિલક - that comes after it.
  const labelValid = /^\d{4}-\d{2}$/.test(nextLabel.trim());
  const earlier = labelValid && isEarlierYear(nextLabel.trim(), preview.year.label);
  const typedOpenings = earlier ? olderOpenings : openings;
  const setTypedOpenings = earlier ? setOlderOpenings : setOpenings;
  /** What a head opens with when the school types nothing. */
  const baseOf = (row: YearEndPreviewDto["rows"][number]): number => (earlier ? 0 : row.closingPaise);

  // What each head will open with, or null where the typed amount is not one.
  const openingOf = (row: YearEndPreviewDto["rows"][number]): number | null => {
    const typed = typedOpenings[row.grantHeadId];
    return typed === undefined || (earlier && typed.trim() === "") ? baseOf(row) : tryParseAmount(typed);
  };
  const openingsValid = preview.rows.every((row) => {
    const paise = openingOf(row);
    return paise !== null;
  });
  const totalOpening = preview.rows.reduce((sum, row) => sum + (openingOf(row) ?? 0), 0);

  const labelTaken = preview.existingLabels.includes(nextLabel.trim());
  const closed = preview.year.status !== "OPEN";
  const canClose =
    !closed &&
    labelValid &&
    !labelTaken &&
    preview.blocking.length === 0 &&
    (earlier || preview.cashPaise === 0) &&
    openingsValid &&
    !busy;

  async function closeYear(): Promise<void> {
    if (!canClose) return;
    if (!(await askConfirm(t.yearConfirmClose(preview!.year.label, nextLabel.trim())))) return;

    setBusy(true);
    // Only the heads the school changed; the rest carry their closing over (or,
    // for an older year, open at zero).
    const changed = Object.fromEntries(
      preview!.rows
        .filter((row) => openingOf(row) !== baseOf(row))
        .map((row) => [row.grantHeadId, openingOf(row)!]),
    );
    const result = await api.closeYear({ nextLabel: nextLabel.trim(), openings: changed });
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    // The main process rebinds to the new year and reloads the window, so there
    // is nothing to refetch here - the whole app comes back on the new year.
    setIssues([]);
  }

  async function reopenYear(year: FinancialYearDto): Promise<void> {
    if (busy) return;
    if (!(await askConfirm(t.yearConfirmReopen(year.label)))) return;
    setBusy(true);
    const result = await api.openYear(year.id);
    setBusy(false);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    const [nextPreview, nextYears] = await Promise.all([
      api.getYearEndPreview(),
      api.listFinancialYears(),
    ]);
    setPreview(nextPreview);
    setYears(nextYears);
  }

  async function confirmRename(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setRenameError(null);
    const result = await api.renameYear(renameLabel.trim());
    setBusy(false);
    if (!result.ok) {
      setRenameError(result.issues[0]?.messageGu ?? result.issues[0]?.messageEn ?? "Error renaming year");
      return;
    }
    // The main process rebinds the year under its new label and reloads the
    // window, so every screen shows the new label and dates.
    setRenaming(false);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    const result = await api.deleteYear({
      yearId: deleteTarget.id,
      password: deletePassword,
    });
    setDeleting(false);
    if (!result.ok) {
      const msg = result.issues[0]?.messageGu ?? result.issues[0]?.messageEn ?? "Error deleting year";
      setDeleteError(msg);
      return;
    }
    setDeleteTarget(null);
    setDeletePassword("");
    setDeleteError(null);
    const [nextPreview, nextYears] = await Promise.all([
      api.getYearEndPreview(),
      api.listFinancialYears(),
    ]);
    setPreview(nextPreview);
    setYears(nextYears);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{t.yearEndTitle}</h2>
          <p>{t.yearEndSubtitle}</p>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <IssueList issues={issues} />
        </div>
      )}

      <section className="card">
        <h3>{t.yearEndClosingSection(preview.year.label, formatDate(preview.year.endDate))}</h3>
        <table>
          <thead>
            <tr>
              <th>{t.grantHead}</th>
              <th className="num">{t.yearEndClosing}</th>
              <th className="num">{earlier ? t.yearEndOlderOpening(nextLabel.trim()) : t.yearEndNextOpening}</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const paise = openingOf(row);
              const changed = !earlier && paise !== row.closingPaise;
              return (
                <tr key={row.headCode}>
                  <td>{row.headNameGu}</td>
                  <td className="num">
                    <Money paise={row.closingPaise} />
                  </td>
                  <td className="num">
                    {closed ? (
                      <Money paise={row.closingPaise} />
                    ) : (
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                        {changed && paise !== null && (
                          <button
                            type="button"
                            className="ghost small"
                            title={t.yearEndOpeningReset}
                            onClick={() =>
                              setOpenings((current) => ({
                                ...current,
                                [row.grantHeadId]: amountToInput(row.closingPaise),
                              }))
                            }
                          >
                            {t.yearEndOpeningChanged} ↺
                          </button>
                        )}
                        <input
                          className="num-input"
                          inputMode="decimal"
                          style={{
                            width: 130,
                            textAlign: "right",
                            borderColor: paise === null ? "var(--error-line)" : undefined,
                          }}
                          value={typedOpenings[row.grantHeadId] ?? ""}
                          placeholder={earlier ? "0.00" : undefined}
                          onChange={(event) =>
                            setTypedOpenings((current) => ({ ...current, [row.grantHeadId]: event.target.value }))
                          }
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="total-row">
              <td>{t.total}</td>
              <td className="num">
                <Money paise={preview.totalClosingPaise} />
              </td>
              <td className="num">
                <Money paise={closed ? preview.totalClosingPaise : totalOpening} />
              </td>
            </tr>
          </tbody>
        </table>
        {!closed && (
          <p className={earlier ? "issue warning" : "muted"}>
            {earlier ? t.yearEndOlderYearHint(nextLabel.trim(), preview.year.label) : t.yearEndNextOpeningHint}
          </p>
        )}
      </section>

      <section className="card">
        <h3>{t.yearEndCloseSection}</h3>

        {closed && (
          <div className="issue warning" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>{t.yearAlreadyClosed(preview.year.label)}</div>
            <button
              type="button"
              className="ghost small"
              disabled={busy}
              onClick={() => void reopenYear(preview.year)}
            >
              {t.yearReopen}
            </button>
          </div>
        )}

        {preview.blocking.length > 0 && (
          <>
            <div className="issue error">
              <div>{t.yearBlockedByErrors}</div>
            </div>
            <IssueList issues={preview.blocking} />
          </>
        )}

        {preview.cashPaise !== 0 && !earlier && (
          <div className="issue error">
            <div>{t.yearBlockedByCash}</div>
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label>{t.yearNextLabel}</label>
            <input
              className="num-input"
              data-suggest="year.label"
              value={nextLabel}
              onChange={(event) => setNextLabel(event.target.value)}
            />
            {labelTaken && (
              <span className="muted" style={{ fontSize: 12, color: "var(--error-line)" }}>
                {t.yearLabelTaken}
              </span>
            )}
          </div>
        </div>

        <p className="muted">{t.yearCloseExplainer}</p>

        <div className="form-actions">
          <button className="primary" disabled={!canClose} onClick={() => void closeYear()}>
            {busy ? "…" : t.yearCloseButton}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>{t.yearListSection}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {t.yearListHint}
        </p>
        <table>
          <thead>
            <tr>
              <th>{t.year}</th>
              <th>{t.date}</th>
              <th>{t.yearStatus}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <tr key={year.id}>
                <td className="num">{year.label}</td>
                <td className="num">
                  {formatDate(year.startDate)} – {formatDate(year.endDate)}
                </td>
                <td>{year.status === "OPEN" ? t.yearOpen : t.yearClosed}</td>
                <td>
                  <div className="row-actions" style={{ display: "flex", gap: "8px", alignItems: "center", justifyContent: "flex-end" }}>
                    {year.id === preview.year.id ? (
                      <>
                        <span className="muted">{t.yearCurrent}</span>
                        {/* Only the open year can be edited, so only it can be renamed. */}
                        {!closed && (
                          <button
                            type="button"
                            className="ghost small"
                            disabled={busy}
                            onClick={() => {
                              setRenaming(true);
                              setRenameLabel(year.label);
                              setRenameError(null);
                            }}
                          >
                            {t.yearRename}
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ghost small"
                        disabled={busy}
                        onClick={() => void reopenYear(year)}
                      >
                        {t.yearReopen}
                      </button>
                    )}
                    {years.length > 1 && (
                      <button
                        type="button"
                        className="ghost small"
                        style={{ color: "var(--error-line, #c53030)" }}
                        disabled={busy}
                        onClick={() => {
                          setDeleteTarget(year);
                          setDeletePassword("");
                          setDeleteError(null);
                        }}
                      >
                        {t.yearDelete}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {renaming &&
        createPortal(
          <div className="custom-colour-backdrop" onClick={() => !busy && setRenaming(false)}>
            <div
              className="custom-colour"
              style={{ width: 440, padding: "20px 24px" }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3 style={{ margin: "0 0 12px" }}>{t.yearRenamePrompt(preview.year.label)}</h3>
              <p style={{ margin: "0 0 16px", fontSize: "13px", lineHeight: "1.5", color: "var(--muted)" }}>
                {t.yearRenameHint}
              </p>

              {renameError && (
                <div className="issue error" style={{ marginBottom: "16px" }}>
                  <div>{renameError}</div>
                </div>
              )}

              <div className="field" style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: 500, fontSize: "13px" }}>
                  {t.yearRenameNewLabel}
                </label>
                <input
                  className="num-input"
                  autoFocus
                  value={renameLabel}
                  onChange={(e) => setRenameLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameLabel.trim()) void confirmRename();
                  }}
                  disabled={busy}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button type="button" className="ghost small" disabled={busy} onClick={() => setRenaming(false)}>
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="primary small"
                  disabled={busy || !renameLabel.trim() || renameLabel.trim() === preview.year.label}
                  onClick={() => void confirmRename()}
                >
                  {busy ? "…" : t.yearRenameSubmit}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {deleteTarget &&
        createPortal(
          <div className="custom-colour-backdrop" onClick={() => !deleting && setDeleteTarget(null)}>
            <div
              className="custom-colour"
              style={{ width: 440, padding: "20px 24px" }}
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3 style={{ margin: "0 0 12px", color: "var(--error-line, #c53030)" }}>
                {t.yearDeletePrompt(deleteTarget.label)}
              </h3>
              <p style={{ margin: "0 0 16px", fontSize: "13px", lineHeight: "1.5", color: "var(--muted)" }}>
                {t.yearDeleteWarning}
              </p>

              {deleteError && (
                <div className="issue error" style={{ marginBottom: "16px" }}>
                  <div>{deleteError}</div>
                </div>
              )}

              <div className="field" style={{ marginBottom: "20px" }}>
                <label style={{ display: "block", marginBottom: "6px", fontWeight: 500, fontSize: "13px" }}>
                  {t.yearDeletePasswordLabel}
                </label>
                <input
                  type="password"
                  autoFocus
                  placeholder={t.yearDeletePasswordPlaceholder}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && deletePassword.trim()) {
                      void confirmDelete();
                    }
                  }}
                  disabled={deleting}
                  style={{ width: "100%", boxSizing: "border-box" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                <button
                  type="button"
                  className="ghost small"
                  disabled={deleting}
                  onClick={() => setDeleteTarget(null)}
                >
                  {t.cancel}
                </button>
                <button
                  type="button"
                  className="primary small"
                  style={{
                    backgroundColor: "var(--error-line, #c53030)",
                    borderColor: "var(--error-line, #c53030)",
                    color: "#fff",
                  }}
                  disabled={deleting || !deletePassword.trim()}
                  onClick={() => void confirmDelete()}
                >
                  {deleting ? "…" : t.yearDeleteSubmit}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
