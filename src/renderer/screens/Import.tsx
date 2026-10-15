import { useState } from "react";
import type { JSX } from "react";
import { api } from "../api.js";
import type {
  GrantHeadDto,
  LegacyImportPreviewDto,
  LegacyImportResultDto,
  LegacyImportSelection,
} from "../../shared/api.js";
import type { ChequeType } from "../../lib/types.js";
import type { Issue } from "../../engine/validation.js";
import { IssueList } from "../components/IssueList.js";
import { Money } from "../components/Money.js";
import { amountToInput, formatDate, tryParseAmount } from "../format.js";
import { useStrings, type Strings } from "../i18n/index.js";
import { useEffect } from "react";

/**
 * Bringing an old Excel workbook in.
 *
 * Three steps, in one screen so the school can see where they are: choose the
 * file, review what was read, import.
 *
 * The review step is the whole screen, not a formality. The old workbook has no
 * grant-head column for bills and no cheque type, and its dates and bill numbers
 * have been through Excel's date guessing - so every row here has a head to
 * confirm, and every note the importer made is printed beside the row it belongs
 * to. Rows can be left out, and nothing at all is written until the button at the
 * bottom is pressed.
 */
type Row = {
  include: boolean;
  grantHeadId: number | null;
  type?: ChequeType;
  /** A grant return's share per head, as typed. */
  split?: Share[];
};
type Share = { grantHeadId: number | null; amount: string };

export function Import({ onChanged }: { onChanged: () => void }): JSX.Element {
  const t = useStrings();
  const [heads, setHeads] = useState<GrantHeadDto[]>([]);
  const [preview, setPreview] = useState<LegacyImportPreviewDto | null>(null);
  const [receipts, setReceipts] = useState<Record<number, Row>>({});
  const [bills, setBills] = useState<Record<number, Row>>({});
  const [cheques, setCheques] = useState<Record<number, Row>>({});
  const [result, setResult] = useState<LegacyImportResultDto | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listGrantHeads().then(setHeads);
  }, []);

  async function choose(): Promise<void> {
    setBusy(true);
    setIssues([]);
    setResult(null);
    const picked = await api.pickLegacyFile();
    if (!picked.ok) {
      setBusy(false);
      setIssues(picked.issues);
      return;
    }
    if (picked.data === null) {
      setBusy(false);
      return;
    }

    const read = await api.previewLegacyImport(picked.data);
    setBusy(false);
    if (!read.ok) {
      setIssues(read.issues);
      return;
    }

    const plan = read.data.plan;
    const headIdFor = new Map(
      read.data.headMatches.map((match) => [match.fileName, match.grantHeadId]),
    );
    const idByName = new Map((await api.listGrantHeads()).map((head) => [head.nameGu, head.id]));
    const openings = new Map(
      (await api.listOpeningBalances()).map((row) => [row.grantHeadId, row.bankPaise + row.cashPaise]),
    );

    setPreview(read.data);
    setReceipts(
      Object.fromEntries(
        plan.receipts.map((row) => [
          row.sourceRow,
          { include: true, grantHeadId: headIdFor.get(row.headNameGu) ?? null },
        ]),
      ),
    );
    setBills(
      Object.fromEntries(
        plan.bills.map((row) => [
          row.sourceRow,
          {
            // A "grant returned" line in the bill register is not a bill at all;
            // it is there because the printed form lists it. Left out by default.
            include: !row.descriptionGu.includes("પરત"),
            grantHeadId:
              row.suggestedHeadName === null
                ? null
                : (idByName.get(row.suggestedHeadName) ?? null),
          },
        ]),
      ),
    );
    setCheques(
      Object.fromEntries(
        plan.cheques.map((row) => [
          row.sourceRow,
          {
            include: true,
            type: row.suggestedType,
            grantHeadId: null,
            split: suggestSplit(
              row.suggestedHeadNames.map(
                (name) => headIdFor.get(name) ?? idByName.get(name) ?? null,
              ),
              openings,
              row.amountPaise,
            ),
          },
        ]),
      ),
    );
  }

  const chosenReceipts = Object.entries(receipts).filter(([, row]) => row.include);
  const chosenBills = Object.entries(bills).filter(([, row]) => row.include);
  const chosenCheques = Object.entries(cheques).filter(([, row]) => row.include);

  // Nothing may be written until every included row has the head it needs: the
  // importer cannot invent one, and a bill under the wrong head is a wrong
  // Annexure 10 for the year.
  const missingHeads =
    chosenReceipts.filter(([, row]) => row.grantHeadId === null).length +
    chosenBills.filter(([, row]) => row.grantHeadId === null).length +
    chosenCheques.filter(
      ([sourceRow, row]) =>
        row.type === "GRANT_RETURN" &&
        splitProblem(row.split ?? [], chequeAmount(preview, Number(sourceRow))) !== null,
    ).length;

  const canImport =
    preview !== null && !preview.yearHasData && missingHeads === 0 && !busy && result === null;

  async function runImport(): Promise<void> {
    if (!preview || !canImport) return;
    if (!window.confirm(t.importConfirm(chosenReceipts.length, chosenBills.length, chosenCheques.length)))
      return;

    const selection: LegacyImportSelection = {
      plan: preview.plan,
      receipts: chosenReceipts.map(([sourceRow, row]) => ({
        sourceRow: Number(sourceRow),
        grantHeadId: row.grantHeadId!,
      })),
      bills: chosenBills.map(([sourceRow, row]) => ({
        sourceRow: Number(sourceRow),
        grantHeadId: row.grantHeadId!,
      })),
      cheques: chosenCheques.map(([sourceRow, row]) => ({
        sourceRow: Number(sourceRow),
        type: row.type ?? "DIRECT",
        returnSplit:
          row.type === "GRANT_RETURN"
            ? (row.split ?? []).map((share) => ({
                grantHeadId: share.grantHeadId!,
                amountPaise: tryParseAmount(share.amount) ?? 0,
              }))
            : [],
      })),
    };

    setBusy(true);
    const applied = await api.applyLegacyImport(selection);
    setBusy(false);
    if (!applied.ok) {
      setIssues(applied.issues);
      return;
    }
    setIssues([]);
    setResult(applied.data);
    onChanged();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h2>{t.importTitle}</h2>
          <p>{t.importSubtitle}</p>
        </div>
        <button className="primary" disabled={busy} onClick={() => void choose()}>
          {busy ? "…" : t.importChooseFile}
        </button>
      </div>

      {issues.length > 0 && (
        <div className="card">
          <IssueList issues={issues} />
        </div>
      )}

      {result !== null && (
        <div className="card">
          <div className="issue">
            <div>{t.importDone(result.receipts, result.bills, result.cheques)}</div>
          </div>
          {result.skipped.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t.importSourceRow}</th>
                  <th>{t.importSkippedReason}</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((row, index) => (
                  <tr key={index}>
                    <td className="num">{row.sourceRow}</td>
                    <td>{row.reasonGu}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {preview === null && result === null && (
        <div className="card">
          <p className="muted">{t.importExplainer}</p>
        </div>
      )}

      {preview !== null && result === null && (
        <>
          {preview.yearHasData && (
            <div className="issue error">
              <div>{t.importYearNotEmpty}</div>
            </div>
          )}
          {preview.plan.issues.length > 0 && (
            <div className="card">
              <IssueList issues={preview.plan.issues} />
            </div>
          )}

          <section className="card">
            <h3>{t.importReceipts(preview.plan.receipts.length)}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t.importInclude}</th>
                  <th>{t.date}</th>
                  <th>{t.importFileHead}</th>
                  <th>{t.grantHead}</th>
                  <th className="num">{t.amount}</th>
                  <th>{t.importNotes}</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.receipts.map((row) => (
                  <tr key={row.sourceRow}>
                    <td>
                      <Include rows={receipts} setRows={setReceipts} sourceRow={row.sourceRow} />
                    </td>
                    <td className="num">{row.date ? formatDate(row.date) : "—"}</td>
                    <td>{row.headNameGu}</td>
                    <td>
                      <HeadPicker
                        heads={heads}
                        rows={receipts}
                        setRows={setReceipts}
                        sourceRow={row.sourceRow}
                      />
                    </td>
                    <td className="num">
                      <Money paise={row.amountPaise} />
                    </td>
                    <td className="muted">{row.notes.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>{t.importBills(preview.plan.bills.length)}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t.importInclude}</th>
                  <th className="num">{t.voucher}</th>
                  <th>{t.billNo}</th>
                  <th>{t.billDate}</th>
                  <th>{t.billDescription}</th>
                  <th>{t.grantHead}</th>
                  <th className="num">{t.amount}</th>
                  <th>{t.importNotes}</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.bills.map((row) => (
                  <tr key={row.sourceRow}>
                    <td>
                      <Include rows={bills} setRows={setBills} sourceRow={row.sourceRow} />
                    </td>
                    <td className="num">{row.voucherNo ?? "—"}</td>
                    <td className="num">{row.billNo ?? "—"}</td>
                    <td className="num">{row.billDate ? formatDate(row.billDate) : "—"}</td>
                    <td>{row.descriptionGu}</td>
                    <td>
                      <HeadPicker
                        heads={heads}
                        rows={bills}
                        setRows={setBills}
                        sourceRow={row.sourceRow}
                      />
                    </td>
                    <td className="num">
                      <Money paise={row.amountPaise} />
                    </td>
                    <td className="muted">{row.notes.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>{t.importCheques(preview.plan.cheques.length)}</h3>
            <table>
              <thead>
                <tr>
                  <th>{t.importInclude}</th>
                  <th className="num">{t.chequeNo}</th>
                  <th>{t.chequeDate}</th>
                  <th>{t.payee}</th>
                  <th>{t.chequePurpose}</th>
                  <th>{t.chequeType}</th>
                  <th>{t.grantHead}</th>
                  <th className="num">{t.amount}</th>
                </tr>
              </thead>
              <tbody>
                {preview.plan.cheques.map((row) => {
                  const chosen = cheques[row.sourceRow];
                  return (
                    <tr key={row.sourceRow}>
                      <td>
                        <Include rows={cheques} setRows={setCheques} sourceRow={row.sourceRow} />
                      </td>
                      <td className="num">{row.chequeNo ?? "—"}</td>
                      <td className="num">{row.chequeDate ? formatDate(row.chequeDate) : "—"}</td>
                      <td>{row.payeeGu}</td>
                      <td>{row.purposeGu}</td>
                      <td>
                        <select
                          value={chosen?.type ?? row.suggestedType}
                          onChange={(event) =>
                            setCheques((current) => ({
                              ...current,
                              [row.sourceRow]: {
                                ...(current[row.sourceRow] ?? { include: true, grantHeadId: null }),
                                type: event.target.value as ChequeType,
                                split: current[row.sourceRow]?.split?.length
                                  ? current[row.sourceRow]!.split
                                  : suggestSplit([], new Map(), row.amountPaise),
                              },
                            }))
                          }
                        >
                          <option value="REIMBURSEMENT">{t.typeReimbursement}</option>
                          <option value="DIRECT">{t.typeDirect}</option>
                          <option value="GRANT_RETURN">{t.typeGrantReturn}</option>
                        </select>
                      </td>
                      <td>
                        {/* Only a grant return has a head of its own; the other
                            two take theirs from the bills they pay. */}
                        {chosen?.type === "GRANT_RETURN" ? (
                          <ReturnSplit
                            t={t}
                            heads={heads}
                            split={chosen.split ?? []}
                            amountPaise={row.amountPaise}
                            onChange={(split) =>
                              setCheques((current) => ({
                                ...current,
                                [row.sourceRow]: { ...current[row.sourceRow]!, split },
                              }))
                            }
                          />
                        ) : (
                          <span className="muted">{t.importFromBills}</span>
                        )}
                      </td>
                      <td className="num">
                        <Money paise={row.amountPaise} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="form-actions">
            <button className="primary" disabled={!canImport} onClick={() => void runImport()}>
              {busy ? "…" : t.importRun}
            </button>
            {missingHeads > 0 && <span className="muted">{t.importMissingHeads(missingHeads)}</span>}
          </div>
        </>
      )}
    </>
  );
}

function Include({
  rows,
  setRows,
  sourceRow,
}: {
  rows: Record<number, Row>;
  setRows: (update: (current: Record<number, Row>) => Record<number, Row>) => void;
  sourceRow: number;
}): JSX.Element {
  const row = rows[sourceRow];
  return (
    <input
      type="checkbox"
      checked={row?.include ?? false}
      onChange={(event) =>
        setRows((current) => ({
          ...current,
          [sourceRow]: {
            ...(current[sourceRow] ?? { include: true, grantHeadId: null }),
            include: event.target.checked,
          },
        }))
      }
    />
  );
}

function HeadPicker({
  heads,
  rows,
  setRows,
  sourceRow,
}: {
  heads: GrantHeadDto[];
  rows: Record<number, Row>;
  setRows: (update: (current: Record<number, Row>) => Record<number, Row>) => void;
  sourceRow: number;
}): JSX.Element {
  const row = rows[sourceRow];
  return (
    <select
      value={row?.grantHeadId ?? ""}
      style={row?.grantHeadId === null ? { borderColor: "var(--error-line)" } : undefined}
      onChange={(event) =>
        setRows((current) => ({
          ...current,
          [sourceRow]: {
            ...(current[sourceRow] ?? { include: true, grantHeadId: null }),
            grantHeadId: event.target.value === "" ? null : Number(event.target.value),
          },
        }))
      }
    >
      <option value="">—</option>
      {heads.map((head) => (
        <option key={head.id} value={head.id}>
          {head.nameGu}
        </option>
      ))}
    </select>
  );
}

/**
 * The first guess at how a grant return splits across the heads its purpose
 * names. A return usually sends back what was left over from last year, so each
 * head but the last is given its opening balance (no more than is left), and the
 * last head takes the rest. The reviewer can change any of it.
 */
function suggestSplit(
  headIds: (number | null)[],
  openings: Map<number, number>,
  amountPaise: number,
): Share[] {
  const ids = [...new Set(headIds.filter((id): id is number => id !== null))];
  if (ids.length === 0) return [{ grantHeadId: null, amount: amountToInput(amountPaise) }];

  let remaining = amountPaise;
  return ids.map((grantHeadId, index) => {
    const share =
      index === ids.length - 1
        ? remaining
        : Math.max(0, Math.min(openings.get(grantHeadId) ?? 0, remaining));
    remaining -= share;
    return { grantHeadId, amount: amountToInput(share) };
  });
}

function chequeAmount(preview: LegacyImportPreviewDto | null, sourceRow: number): number {
  return preview?.plan.cheques.find((row) => row.sourceRow === sourceRow)?.amountPaise ?? 0;
}

/** Why this split cannot be imported yet, or null when it can. */
function splitProblem(split: Share[], amountPaise: number): "head" | "total" | null {
  if (split.length === 0 || split.some((share) => share.grantHeadId === null)) return "head";
  if (new Set(split.map((share) => share.grantHeadId)).size !== split.length) return "head";
  const amounts = split.map((share) => tryParseAmount(share.amount));
  if (amounts.some((amount) => amount === null)) return "total";
  const total = amounts.reduce<number>((sum, amount) => sum + amount!, 0);
  return total === amountPaise ? null : "total";
}

/** One line per head a grant return went back from, with that head's share. */
function ReturnSplit({
  t,
  heads,
  split,
  amountPaise,
  onChange,
}: {
  t: Strings;
  heads: GrantHeadDto[];
  split: Share[];
  amountPaise: number;
  onChange: (split: Share[]) => void;
}): JSX.Element {
  const problem = splitProblem(split, amountPaise);
  const update = (index: number, change: Partial<Share>): void =>
    onChange(split.map((share, at) => (at === index ? { ...share, ...change } : share)));

  return (
    <div style={{ display: "grid", gap: 4 }}>
      {split.map((share, index) => (
        <div key={index} style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <select
            value={share.grantHeadId ?? ""}
            style={share.grantHeadId === null ? { borderColor: "var(--error-line)" } : undefined}
            onChange={(event) =>
              update(index, {
                grantHeadId: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          >
            <option value="">—</option>
            {heads.map((head) => (
              <option key={head.id} value={head.id}>
                {head.nameGu}
              </option>
            ))}
          </select>
          <input
            className="num-input"
            inputMode="decimal"
            style={{ width: 90 }}
            value={share.amount}
            placeholder="0.00"
            onChange={(event) => update(index, { amount: event.target.value })}
          />
          {split.length > 1 && (
            <button
              type="button"
              title={t.importRemoveHead}
              onClick={() => onChange(split.filter((_, at) => at !== index))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={() => onChange([...split, { grantHeadId: null, amount: "" }])}
        >
          {t.importAddHead}
        </button>
      </div>
      {problem === "total" && (
        <span style={{ color: "var(--error-line)" }}>{t.importSplitMismatch}</span>
      )}
    </div>
  );
}
