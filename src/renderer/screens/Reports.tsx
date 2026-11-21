import { useEffect, useState } from "react";
import type { JSX } from "react";
import { api } from "../api.js";
import type { DayBalance, Ledger } from "../../engine/types.js";
import {
  PRINTABLE_REPORTS,
  reportsForMode,
  type AppMode,
  type ApplyLayoutResultDto,
  type PrintableReportId,
} from "../../shared/api.js";
import type { Issue } from "../../engine/validation.js";
import { IssueList } from "../components/IssueList.js";
import { Money } from "../components/Money.js";
import { formatDate } from "../format.js";
import { useStrings, type Strings } from "../i18n/index.js";
import { PrintRoot } from "../print/PrintRoot.js";
import { LayoutEditor } from "./LayoutEditor.js";
import { PrintDialog } from "./PrintDialog.js";
import { paperOf, resolvePage } from "../../shared/report-layout.js";
import "../print/print.css";
import { Icon } from "../components/Icon.js";
import { askConfirm } from "../components/ConfirmDialog.js";

/**
 * Reports.
 *
 * Two kinds of tab:
 *
 *  - **Printable forms** render `PrintRoot`, the very component the PDF is made
 *    from. The preview is therefore the artefact rather than a picture of it,
 *    so a layout problem shows up here before anyone exports one.
 *  - **Figures** are working views of numbers that have no form of their own
 *    yet: the running balances, the ledgers, and the reconciliation.
 */
type FigureTab = "balances" | "ledgers";
type Tab = PrintableReportId | FigureTab;

const STATUTORY_TABS: PrintableReportId[] = ["rojmel", "khatavahi", "annexure10", "annexure9", "patrakD"];
const REGISTER_TABS: PrintableReportId[] = ["grantRegister", "chequeRegister", "pfmsRegister", "billRegister", "vouchers"];
const FIGURE_TABS: FigureTab[] = ["balances", "ledgers"];

function labelFor(tab: Tab, t: Strings): string {
  switch (tab) {
    case "rojmel":
      return t.tabRojmel;
    case "khatavahi":
      return t.tabLedgers;
    case "annexure9":
      return t.tabAnnexure9;
    case "grantRegister":
      return t.tabGrantRegisterPrint;
    case "chequeRegister":
      return t.tabChequeRegister;
    case "pfmsRegister":
      return t.tabPfmsRegister;
    case "billRegister":
      return t.tabBillRegister;
    case "vouchers":
      return t.tabVouchers;
    case "patrakD":
      return t.tabPatrakD;
    case "annexure10":
      return t.tabAnnexure10;
    case "balances":
      return t.tabBalances;
    case "ledgers":
      return t.tabLedgers;
  }
}

function isPrintable(tab: Tab): tab is PrintableReportId {
  return (PRINTABLE_REPORTS as readonly string[]).includes(tab);
}

type ExportKind = "pdf" | "excel" | "excel-all";

/**
 * Every report as a card on one page. Print, PDF and Excel work straight from
 * a card; the preview (and, from there, the layout editor) opens the report
 * on its own page, with a way back to the cards.
 */
export function Reports({ mode = "smc-e" }: { mode?: AppMode }): JSX.Element {
  const t = useStrings();
  // SMC prints a PFMS register in place of the cheque register, and no પત્રક-D.
  const inMode = new Set<Tab>([...reportsForMode(mode), ...FIGURE_TABS]);
  const [tab, setTab] = useState<Tab>("rojmel");
  // Showing one report (its preview, or a figure view) rather than the cards.
  const [open, setOpen] = useState(false);
  // One export at a time: which kind, and for which report, so only that
  // card's button says it is working.
  const [saving, setSaving] = useState<{ kind: ExportKind; report: PrintableReportId | "all" } | null>(null);
  const [saved, setSaved] = useState<{ kind: "pdf" | "excel"; path: string } | null>(null);
  // The layout editor replaces the preview while it is open. The exports are
  // hidden meanwhile: they print the SAVED layout, and a half-edited one on
  // screen beside them would say otherwise.
  const [editing, setEditing] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  // The print window, over everything while it is open.
  const [printing, setPrinting] = useState(false);
  // Bumped when the print window saved new settings, so the summary reloads.
  const [pageVersion, setPageVersion] = useState(0);
  const pageSummary = usePageSummary(open && isPrintable(tab) ? tab : null, pageVersion, t);

  /** Leaving the editor, or its report, with changes not saved: ask first. */
  async function mayLeaveEditor(): Promise<boolean> {
    return !editing || !layoutDirty || (await askConfirm(t.layoutDiscardConfirm));
  }

  function select(next: Tab): void {
    setTab(next);
    setSaved(null);
    setApplyResult(null);
    setLayoutDirty(false);
    setEditing(false);
    setPrinting(false);
  }

  function openReport(next: Tab): void {
    select(next);
    setOpen(true);
  }

  async function backToCards(): Promise<void> {
    if (!(await mayLeaveEditor())) return;
    setEditing(false);
    setLayoutDirty(false);
    setOpen(false);
  }

  function printReport(report: PrintableReportId): void {
    select(report);
    setPrinting(true);
  }

  /** Every export ends the same way: a path to report, or a cancelled dialog. */
  function runExport(kind: ExportKind, report: PrintableReportId | "all"): void {
    setSaving({ kind, report });
    setSaved(null);
    const work = kind === "pdf" ? api.exportPdf(report as PrintableReportId) : api.exportExcel(report);
    void work
      .then((result) => {
        if (result.ok && result.data) {
          setSaved({ kind: kind === "pdf" ? "pdf" : "excel", path: result.data });
        }
      })
      .finally(() => setSaving(null));
  }

  // "Apply this layout to all schools": what happened, shown under the head.
  const [applyResult, setApplyResult] = useState<
    { ok: true; data: ApplyLayoutResultDto } | { ok: false; issues: Issue[] } | null
  >(null);
  const [applying, setApplying] = useState(false);

  /** Copy the saved layout of this one report into every other school's books. */
  async function applyToAll(report: PrintableReportId): Promise<void> {
    if (!(await askConfirm(t.applyLayoutConfirm(labelFor(report, t))))) return;
    setApplying(true);
    setApplyResult(null);
    try {
      setApplyResult(await api.applyLayoutToAllSchools(report));
    } finally {
      setApplying(false);
    }
  }

  const applied = applyResult !== null && (
    applyResult.ok ? (
      <div className={`issue ${applyResult.data.skipped.length > 0 ? "warning" : "success"}`}>
        <div>
          <div>{t.applyLayoutDone(applyResult.data.applied.length)}</div>
          {applyResult.data.applied.length > 0 && (
            <div className="muted">{applyResult.data.applied.join(", ")}</div>
          )}
          {applyResult.data.skipped.map((skip) => (
            <div key={skip.profileId}>
              {skip.schoolNameGu}: {t.applyLayoutSkipped[skip.reason]}
            </div>
          ))}
        </div>
      </div>
    ) : (
      <IssueList issues={applyResult.issues} />
    )
  );

  const busy = saving !== null || applying;
  const isSaving = (kind: ExportKind, report: PrintableReportId | "all"): boolean =>
    saving?.kind === kind && saving.report === report;

  const savedNotice = saved !== null && (
    <div className="issue success">
      <div>{saved.kind === "pdf" ? t.pdfSaved(saved.path) : t.excelSaved(saved.path)}</div>
    </div>
  );

  // The print window covers the whole window, so it can open from a card or
  // from a report's own page alike.
  const printDialog = printing && isPrintable(tab) && (
    <PrintDialog
      key={tab}
      report={tab}
      reportLabel={labelFor(tab, t)}
      onClose={(changed) => {
        setPrinting(false);
        if (changed) setPageVersion((version) => version + 1);
      }}
    />
  );

  if (!open) {
    const group = (title: string, ids: Tab[]): JSX.Element => (
      <section className="report-group">
        <h3 className="report-group-title">{title}</h3>
        <div className="report-grid">
          {ids.map((id) => (
            <div className="report-card" key={id}>
              <b>{labelFor(id, t)}</b>
              <p>{t.reportBlurbs[id]}</p>
              <div className="report-card-actions">
                {isPrintable(id) ? (
                  <>
                    <button className="ghost small" onClick={() => openReport(id)}>
                      <Icon name="eye" size={14} /> {t.previewShort}
                    </button>
                    <button className="ghost small" disabled={busy} onClick={() => printReport(id)}>
                      <Icon name="print" size={14} /> {t.printOpen}
                    </button>
                    <button className="ghost small" disabled={busy} onClick={() => runExport("pdf", id)}>
                      <Icon name="pdf" size={14} /> {isSaving("pdf", id) ? t.savingPdf : "PDF"}
                    </button>
                    <button className="ghost small" disabled={busy} onClick={() => runExport("excel", id)}>
                      <Icon name="sheet" size={14} /> {isSaving("excel", id) ? t.savingExcel : "Excel"}
                    </button>
                  </>
                ) : (
                  <button className="ghost small" onClick={() => openReport(id)}>
                    <Icon name="eye" size={14} /> {t.openFigures}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    );

    return (
      <>
        <div className="page-head">
          <div>
            <h2>{t.reportsTitle}</h2>
            <p>{t.reportsGridNote}</p>
          </div>
          {/* The whole year in one workbook - the file a BRC asks for when
              they want to check the figures. */}
          <button className="primary" disabled={busy} onClick={() => runExport("excel-all", "all")}>
            <Icon name="sheets" /> {isSaving("excel-all", "all") ? t.savingExcel : t.saveExcelAll}
          </button>
        </div>
        {savedNotice}
        {group(t.groupStatutory, STATUTORY_TABS.filter((id) => inMode.has(id)))}
        {group(t.groupRegisters, REGISTER_TABS.filter((id) => inMode.has(id)))}
        {group(t.groupFigures, FIGURE_TABS)}
        {printDialog}
      </>
    );
  }

  return (
    <>
      {/* Back, Edit layout and the exports stay at the top while the preview
          scrolls under them - a register runs to many pages. */}
      <div className="report-sticky-head">
      <button className="ghost small report-back" onClick={() => void backToCards()}>
        ← {t.allReports}
      </button>
      <div className="page-head">
        <div>
          <h2>{labelFor(tab, t)}</h2>
          <p>
            {editing
              ? t.layoutEditNote
              : isPrintable(tab)
                ? `${t.reportBlurbs[tab]}${pageSummary ? ` (${pageSummary})` : ""}`
                : t.reportBlurbs[tab]}
          </p>
        </div>
        {isPrintable(tab) && !editing && (
          <div className="row-actions">
            <button className="ghost" disabled={busy} onClick={() => setEditing(true)}>
              <Icon name="edit" /> {t.layoutEdit}
            </button>
            <button className="ghost" disabled={busy} onClick={() => void applyToAll(tab)}>
              <Icon name="copy" /> {applying ? t.working : t.applyLayoutToAll}
            </button>
            <button className="ghost" disabled={busy} onClick={() => runExport("pdf", tab)}>
              <Icon name="pdf" /> {isSaving("pdf", tab) ? t.savingPdf : t.savePdf}
            </button>
            <button className="ghost" disabled={busy} onClick={() => runExport("excel", tab)}>
              <Icon name="sheet" /> {isSaving("excel", tab) ? t.savingExcel : t.saveExcel}
            </button>
            <button className="primary" disabled={busy} onClick={() => setPrinting(true)}>
              <Icon name="print" /> {t.printOpen}
            </button>
          </div>
        )}
        {editing && <span className="muted">{t.layoutUnsavedExport}</span>}
      </div>
      </div>

      {savedNotice}
      {applied}

      {isPrintable(tab) && editing ? (
        <LayoutEditor
          key={tab}
          report={tab}
          reportLabel={labelFor(tab, t)}
          onDirtyChange={setLayoutDirty}
          onClose={() => {
            setEditing(false);
            setLayoutDirty(false);
          }}
        />
      ) : isPrintable(tab) ? (
        // Not behind the print window: that window draws the same report, and
        // two copies on screen would share the layout stylesheet's id.
        !printing && (
        <div className="report-preview-frame standalone">
          <div className="report-preview-content">
            <PrintRoot key={tab} report={tab} />
          </div>
        </div>
        )
      ) : (
        <Figures tab={tab} />
      )}
      {printDialog}
    </>
  );
}

/** "A4 (210 × 297 મિમી), આડો, 100%": how the report prints now. */
function usePageSummary(report: PrintableReportId | null, version: number, t: Strings): string | null {
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    setSummary(null);
    if (!report) return;
    let current = true;
    void api
      .getReportLayout(report)
      .then((layout) => {
        if (!current) return;
        const page = resolvePage(report, layout.page);
        const paper = paperOf(page.paper);
        setSummary(
          `${paper.labelGu} ${t.printPaperSizeMm(paper.shortMm, paper.longMm)}, ${
            page.landscape ? t.printLandscape : t.printPortrait
          }, ${Math.round(page.scale * 100)}%`,
        );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [report, version, t]);
  return summary;
}

/** The number-only views: the running balances and the ledgers. */
function Figures({ tab }: { tab: FigureTab }): JSX.Element {
  const t = useStrings();
  const [balances, setBalances] = useState<DayBalance[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [selectedHead, setSelectedHead] = useState<string>("all");

  useEffect(() => {
    void (async () => {
      try {
        const [nextBalances, nextLedgers] = await Promise.all([
          api.getBalances(),
          api.getLedgers(),
        ]);
        setBalances(nextBalances);
        setLedgers(nextLedgers);
      } catch (cause) {
        // Without this the screen spins forever on a failed call, showing a
        // spinner and no clue - which is exactly what happened once.
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

  if (loading) return <div className="state">{t.calculating}</div>;

  if (tab === "balances") {
    return (
      <div className="card">
        <h3>{t.balancesTitle}</h3>
        <table>
          <thead>
            <tr>
              <th>{t.date}</th>
              <th className="num">{t.cash}</th>
              <th className="num">{t.bank}</th>
              <th className="num">{t.total}</th>
            </tr>
          </thead>
          <tbody>
            {balances.map((balance) => (
              <tr key={balance.date}>
                <td className="num">{formatDate(balance.date)}</td>
                <td className="num">
                  <Money paise={balance.cashPaise} />
                </td>
                <td className="num">
                  <Money paise={balance.bankPaise} />
                </td>
                <td className="num">
                  <Money paise={balance.totalPaise} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const filteredLedgers = selectedHead === "all"
    ? ledgers
    : ledgers.filter((acc) => acc.headCode === selectedHead);

  return (
    <>
      <div className="search-filter-bar" style={{ marginBottom: 16 }}>
        <div className="filter-group">
          <label style={{ fontSize: 13, fontWeight: 600, marginRight: 8, color: "var(--ink)" }}>
            ખાતું પસંદ કરો:
          </label>
          <select
            className="filter-select"
            value={selectedHead}
            onChange={(e) => setSelectedHead(e.target.value)}
          >
            <option value="all">બધા ખાતા ({ledgers.length})</option>
            {ledgers.map((acc) => (
              <option key={acc.headCode} value={acc.headCode}>
                {acc.nameGu}
              </option>
            ))}
          </select>
        </div>
        {selectedHead !== "all" && (
          <button
            type="button"
            className="ghost small"
            onClick={() => setSelectedHead("all")}
          >
            {t.clearFilters}
          </button>
        )}
      </div>

      {filteredLedgers.map((account) => (
        <div className="card" key={account.headCode}>
          <h3>{account.nameGu}</h3>
          <table>
            <thead>
              <tr>
                <th>{t.date}</th>
                <th className="num">રોજમેળ પાનું</th>
                <th>{t.colDescription}</th>
                <th className="num">{t.colCredit}</th>
                <th className="num">{t.colDebit}</th>
                <th className="num">{t.colCreditBalance}</th>
                <th className="num">{t.colDebitBalance}</th>
              </tr>
            </thead>
            <tbody>
              {account.rows.map((row, index) => (
                <tr key={index}>
                  <td className="num">{formatDate(row.date)}</td>
                  {/* Filled in now that the cash book is paginated. */}
                  <td className="num">{row.rojmelPage ?? ""}</td>
                  <td>{row.descriptionGu}</td>
                  <td className="num credit">
                    <Money paise={row.creditPaise} />
                  </td>
                  <td className="num debit">
                    <Money paise={row.debitPaise} />
                  </td>
                  <td className="num">
                    <Money paise={row.creditBalancePaise} />
                  </td>
                  <td className="num">
                    <Money paise={row.debitBalancePaise} />
                  </td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>{t.colClosing}</td>
                <td className="num">
                  <Money paise={account.totalCreditPaise} />
                </td>
                <td className="num">
                  <Money paise={account.totalDebitPaise} />
                </td>
                <td className="num">
                  <Money paise={account.closingPaise} />
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}
