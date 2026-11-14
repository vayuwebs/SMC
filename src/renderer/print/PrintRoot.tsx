import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, JSX } from "react";
import { api } from "../api.js";
import type { DashboardDto, GrantRegisterRowDto } from "../../shared/api.js";
import { PRINTABLE_REPORTS, type PrintableReportId } from "../../shared/api.js";
import type { Rojmel } from "../../engine/rojmel.js";
import type { Annexure9, Ledger } from "../../engine/types.js";
import type {
  BillRegisterRow,
  ChequeRegisterRow,
  PatrakDRow,
  Voucher,
} from "../../engine/registers.js";
import { Annexure10Page } from "./Annexure10Page.js";
import { Annexure9Page } from "./Annexure9Page.js";
import { KhatavahiPages } from "./KhatavahiPage.js";
import { RojmelSheet } from "./RojmelPage.js";
import {
  BillRegisterPages,
  ChequeRegisterPages,
  GrantRegisterPages,
  PatrakDPages,
  VoucherPages,
} from "./RegisterPages.js";
import { PrintLayoutGate, sheetZoom, usePrintLayoutGate } from "./PagedSheets.js";
import { ReportLayoutContext, layoutFontsReady, type ReportLayoutValue } from "./layout-context.js";
import {
  columnWidths,
  layoutCss,
  paintShapes,
  MARGIN_EDGES,
  resolvePage,
  type ReportLayout,
} from "../../shared/report-layout.js";
import {
  ROJMEL_MIN_SCALE,
  balancingShiftPx,
  calculateFitScale,
  largestFittingScale,
} from "../../shared/rojmel-adaptive.js";
import "./print.css";

/**
 * The print view: one report, no application chrome.
 *
 * Reached at `#print:<report>`. The same component serves the on-screen preview
 * and the PDF, because the PDF is produced by loading this very route in an
 * offscreen window and calling printToPDF on it. What the user proofreads is
 * therefore the same DOM that becomes the file.
 *
 * The school's own layout for the report (shared/report-layout.ts) is applied
 * here: a stylesheet for fonts, sizes, spacing and highlights, and a context the
 * pages read for column widths and the space after a row. The editor on the
 * Reports screen passes the layout being edited instead of the saved one, so
 * the preview shows each change before it is saved.
 *
 * When the data has rendered - and every table long enough to run over sheets
 * has been measured and split (PagedSheets) - it sets `window.__printReady`.
 * The main process waits for that flag rather than guessing with a timeout, so
 * a slow query can never produce a half-empty PDF.
 */
declare global {
  interface Window {
    __printReady?: boolean;
  }
}

export const PRINT_HASH_PREFIX = "print:";

export type PrintableReport = PrintableReportId;

export function printableReportFromHash(hash: string): PrintableReport | null {
  const value = hash.replace(/^#/, "");
  if (!value.startsWith(PRINT_HASH_PREFIX)) return null;
  const report = value.slice(PRINT_HASH_PREFIX.length) as PrintableReport;
  return PRINTABLE_REPORTS.includes(report) ? report : null;
}

/**
 * Text wider than its rojmel cell.
 *
 *   a description, footer label or receipt reference wraps onto more lines, so
 *     every page keeps one font size;
 *   a voucher or cheque number with its date stays on one line and is set
 *     smaller until it fits - down to 7pt - rather than running into the next
 *     column. Only that cell gets smaller, so a row never grows by it.
 */
const PT = 96 / 72;
const SMALLEST_REF_PX = 7 * PT;

function fitCells(): void {
  // Undo an earlier pass first: after a layout change a cell may fit at its
  // full size again, or need wrapping.
  for (const cell of document.querySelectorAll<HTMLElement>(".print-root [data-fitted]")) {
    cell.style.whiteSpace = "";
    cell.style.fontSize = "";
    cell.removeAttribute("data-fitted");
  }

  const visible = ".print-root .sheet:not([aria-hidden]) table.rojmel";
  const cells = document.querySelectorAll<HTMLElement>(
    `${visible} td.detail:not([data-spill-left]), ${visible} td.label, ${visible} td[data-col='r.ref'], ${visible} td[data-col='r.cheque']`,
  );
  for (const cell of cells) {
    // A cell the school set to one line stays on one line (layoutCss, wrapRules).
    if (cell.scrollWidth > cell.clientWidth + 1 && !getComputedStyle(cell).getPropertyValue("--one-line")) {
      cell.style.whiteSpace = "normal";
      cell.setAttribute("data-fitted", "");
    }
  }

  // Every size is read first and written after, a few rounds at most, so the
  // sheets are not laid out again for each cell. Text width follows font size
  // closely, so one round lands on the right size and the next only trims.
  let pending = [...document.querySelectorAll<HTMLElement>(`${visible} td[data-col='p.ref'], ${visible} td[data-col='p.cheque']`)];
  for (let round = 0; round < 4 && pending.length > 0; round += 1) {
    const tooWide = pending.flatMap((cell) => {
      if (cell.scrollWidth <= cell.clientWidth + 1) return [];
      const style = getComputedStyle(cell);
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const ratio = (cell.clientWidth - padding) / Math.max(1, cell.scrollWidth - padding);
      return [{ cell, size: parseFloat(style.fontSize), ratio }];
    });
    pending = [];
    for (const { cell, size, ratio } of tooWide) {
      if (size <= SMALLEST_REF_PX) continue;
      // The size that fits, to the half pixel below; at least half a pixel
      // smaller than now, so every round makes progress.
      cell.style.fontSize = `${Math.max(SMALLEST_REF_PX, Math.min(size - 0.5, Math.floor(size * ratio * 2) / 2))}px`;
      cell.setAttribute("data-fitted", "");
      pending.push(cell);
    }
  }
}

/** Rounding and hairline borders: a sheet is never filled to the last pixel. */
const SPREAD_SAFETY_PX = 4;

/**
 * Fill each rojmel sheet with its rows. The space a sheet has left over goes
 * into the height of its rows - shared evenly among them - rather than into the
 * gaps between its blocks, which keep their small fixed size. Sheet by sheet:
 * a sheet with more room gets taller rows, a fuller one shorter rows.
 *
 * A row whose height the school set (for that row, its group, or every row of
 * the report) is left as set: RojmelPage marks it data-fixed-height.
 *
 * Everything is read first and written after, so the sheets are laid out once;
 * a second pass takes up what rounding and cell padding left.
 */
function spreadBlocks(): void {
  for (const cell of document.querySelectorAll<HTMLElement>(".print-root [data-spread]")) {
    cell.style.height = "";
    cell.removeAttribute("data-spread");
  }
  for (const title of document.querySelectorAll<HTMLElement>(".print-root .rojmel-title")) {
    title.style.marginTop = "";
  }
  for (const container of document.querySelectorAll<HTMLElement>(".print-root .rojmel-table-container")) {
    container.style.zoom = "";
    container.style.width = "";
  }
  const sheets = [
    ...document.querySelectorAll<HTMLElement>(".print-root > .sheet[data-spread-blocks]:not([aria-hidden])"),
  ];

  // Ensure uniform 12pt text and 14pt title across all rojmel sheets
  for (const sheet of sheets) {
    const zoom = sheetZoom(sheet);
    const top = sheet.getBoundingClientRect().top;
    const used = Math.max(
      0,
      ...[...sheet.children].map(
        (child) =>
          (child.getBoundingClientRect().bottom - top) / zoom + parseFloat(getComputedStyle(child).marginBottom || "0"),
      ),
    );
    const room = parseFloat(getComputedStyle(sheet).minHeight) - used - SPREAD_SAFETY_PX;
    if (room < 0) {
      if (sheet.getAttribute("data-auto-size") !== "12") {
        sheet.setAttribute("data-auto-size", "12");
        sheet.style.setProperty("--rojmel-text", "12pt");
        sheet.style.setProperty("--rojmel-figure", "11pt");
        sheet.style.setProperty("--report-font", "14pt");
        sheet.style.setProperty("--rojmel-row-height", "5.4mm");
      }
      sheet.setAttribute("data-dense", "");
    }
  }

  const plan = (sheet: HTMLElement): { cells: { cell: HTMLElement; px: number }[]; room: number } => {
    const zoom = sheetZoom(sheet);
    // How far the content reaches - the sheet's own box is never shorter than
    // the paper, so its height says nothing about the space left inside it.
    const top = sheet.getBoundingClientRect().top;
    const used = Math.max(
      0,
      ...[...sheet.children].map(
        (child) =>
          (child.getBoundingClientRect().bottom - top) / zoom + parseFloat(getComputedStyle(child).marginBottom || "0"),
      ),
    );
    const rows = [
      ...sheet.querySelectorAll<HTMLElement>("table.rojmel > tbody > tr[data-row]:not([data-fixed-height])"),
    ];
    return {
      cells: rows.flatMap((row) => {
        const cell = row.querySelector<HTMLElement>(":scope > td");
        return cell ? [{ cell, px: row.getBoundingClientRect().height / zoom }] : [];
      }),
      room: parseFloat(getComputedStyle(sheet).minHeight) - used - SPREAD_SAFETY_PX,
    };
  };
  for (let pass = 0; pass < 2; pass += 1) {
    const plans = sheets.map(plan);
    for (const { cells, room } of plans) {
      // Nothing to share, or (second pass) close enough.
      if (cells.length === 0 || Math.abs(room) < 1) continue;
      if (room > 0) {
        const extra = room / cells.length;
        for (const { cell, px } of cells) {
          cell.style.height = `${Math.max(1, px + extra)}px`;
          cell.setAttribute("data-spread", "");
        }
      } else if (pass === 1 && room < -1) {
        // Space is tight; scale row heights down so it strictly fits within the single page
        const needed = Math.abs(room) / cells.length;
        for (const { cell, px } of cells) {
          cell.style.height = `${Math.max(14, px - needed)}px`;
          cell.setAttribute("data-spread", "");
        }
      }
    }
  }

  // Stage 4: If any sheet still has overflow (e.g. dense wrapped descriptions or many bills),
  // apply gentle, non-extreme fit scaling to .rojmel-table-container (clamped >= 0.88)
  // to mathematically guarantee ZERO content clipping (Priority 1: Don't miss any content).
  for (const sheet of sheets) {
    const zoom = sheetZoom(sheet);
    const top = sheet.getBoundingClientRect().top;
    const used = Math.max(
      0,
      ...[...sheet.children].map(
        (child) =>
          (child.getBoundingClientRect().bottom - top) / zoom + parseFloat(getComputedStyle(child).marginBottom || "0"),
      ),
    );
    const room = parseFloat(getComputedStyle(sheet).minHeight) - used - SPREAD_SAFETY_PX;
    if (room < -0.5) {
      const container = sheet.querySelector<HTMLElement>(".rojmel-table-container");
      if (container && sheet.hasAttribute("data-wrapping")) {
        fitWrappedSheet(sheet, container);
      } else if (container) {
        const containerTop = (container.getBoundingClientRect().top - top) / zoom;
        const containerBottom = (container.getBoundingClientRect().bottom - top) / zoom;
        const containerHeight = Math.max(1, containerBottom - containerTop);
        const availableForContainer = containerHeight + room;
        // Non-extreme floor guarantees readability while ensuring all content is visible
        const scale = calculateFitScale(containerHeight, availableForContainer, 0, ROJMEL_MIN_SCALE);
        if (scale < 1) {
          container.style.zoom = String(scale);
          container.style.width = `${Math.round((sheet.clientWidth / scale) * 10) / 10}px`;
        }
      }
    }
  }
  balanceRojmelGaps(sheets);
}

/** What is left of a rojmel sheet under its content, in the sheet's px. */
function roomLeftPx(sheet: HTMLElement): number {
  const zoom = sheetZoom(sheet);
  const top = sheet.getBoundingClientRect().top;
  const used = Math.max(
    0,
    ...[...sheet.children].map(
      (child) =>
        (child.getBoundingClientRect().bottom - top) / zoom + parseFloat(getComputedStyle(child).marginBottom || "0"),
    ),
  );
  return parseFloat(getComputedStyle(sheet).minHeight) - used - SPREAD_SAFETY_PX;
}

/**
 * A sheet the school's wrapping made too tall. The engine's page stands (the
 * ledger prints its number), so the table is zoomed down as little as fits -
 * the zoom is searched for, not worked out, as the lines change with it - and
 * what the search leaves goes back into its rows.
 */
function fitWrappedSheet(sheet: HTMLElement, container: HTMLElement): void {
  // Heights set while the sheet was too tall hold rows at their wrapped size.
  for (const cell of sheet.querySelectorAll<HTMLElement>("[data-spread]")) {
    cell.style.height = "";
    cell.removeAttribute("data-spread");
  }
  const setZoom = (scale: number): void => {
    container.style.zoom = String(scale);
    container.style.width = `${Math.round((sheet.clientWidth / scale) * 10) / 10}px`;
  };
  const scale = largestFittingScale((candidate) => {
    setZoom(candidate);
    return roomLeftPx(sheet) >= 0;
  });
  setZoom(scale);

  const room = roomLeftPx(sheet);
  const rows = [...sheet.querySelectorAll<HTMLElement>("table.rojmel > tbody > tr[data-row]:not([data-fixed-height])")];
  if (room < 1 || rows.length === 0) return;
  // Inside the zoomed table a pixel is `scale` of the sheet's.
  const sheetScale = sheetZoom(sheet) * scale;
  const sizes = rows.map((row) => row.getBoundingClientRect().height / sheetScale);
  rows.forEach((row, index) => {
    const cell = row.querySelector<HTMLElement>(":scope > td");
    if (!cell) return;
    cell.style.height = `${sizes[index]! + room / scale / rows.length}px`;
    cell.setAttribute("data-spread", "");
  });
}

/** Millimetres in CSS px, for the page margins. */
const PX_PER_MM = 96 / 25.4;

/**
 * From the top of a sheet to the top of its title's ink, in the sheet's px.
 * The title's line box starts higher than its letters - the font's ascent and
 * the line's leading are white on paper - so the ink is found from the
 * baseline (a zero-size probe sitting on it) less the glyphs' measured ascent.
 */
function titleInkTopPx(sheet: HTMLElement, title: HTMLElement): number | null {
  const text = title.querySelector<HTMLElement>("[data-text]") ?? title;
  const words = text.textContent?.trim() ?? "";
  const context = document.createElement("canvas").getContext("2d");
  if (!words || !context) return null;
  const style = getComputedStyle(text);
  context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  const ascent = context.measureText(words).actualBoundingBoxAscent;

  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  text.prepend(probe);
  const zoom = sheetZoom(sheet);
  const baseline = (probe.getBoundingClientRect().bottom - sheet.getBoundingClientRect().top) / zoom;
  probe.remove();
  return baseline - ascent;
}

/**
 * Put as much white above the rojmel's title (from the top of its letters) as
 * below its table, on the paper. Runs after the rows are spread, so a full
 * sheet's leftover is only the safety margin; the fullest sheet decides the
 * shift and every sheet takes the same one, so the title sits at the same
 * height on every page and a short last page keeps its space at the bottom.
 */
function balanceRojmelGaps(sheets: HTMLElement[]): void {
  const measured = sheets.flatMap((sheet) => {
    const title = sheet.querySelector<HTMLElement>(":scope > .rojmel-title");
    const inkTop = title ? titleInkTopPx(sheet, title) : null;
    if (!title || inkTop === null) return [];
    const zoom = sheetZoom(sheet);
    const top = sheet.getBoundingClientRect().top;
    const used = Math.max(
      0,
      ...[...sheet.children].map((child) => (child.getBoundingClientRect().bottom - top) / zoom),
    );
    const style = getComputedStyle(sheet);
    const mm = (name: string): number => {
      const value = parseFloat(style.getPropertyValue(name));
      return (Number.isNaN(value) ? 10 : value) * PX_PER_MM;
    };
    return [{
      title,
      inkTop,
      bottomGap: parseFloat(style.minHeight) - used,
      marginTop: mm("--sheet-m-top"),
      marginBottom: mm("--sheet-m-bottom"),
    }];
  });
  if (measured.length === 0) return;
  const fullestGap = Math.min(...measured.map((m) => m.bottomGap));
  for (const m of measured) {
    const shift = Math.min(
      Math.max(0, m.bottomGap),
      balancingShiftPx({ inkTopPx: m.inkTop, bottomGapPx: fullestGap, marginTopPx: m.marginTop, marginBottomPx: m.marginBottom }),
    );
    if (Math.abs(shift) >= 0.25) m.title.style.marginTop = `${Math.round(shift * 100) / 100}px`;
  }
}

/**
 * From the second row onwards in payments (where p.date is empty), descriptions
 * are kept on one line. When a description does not fit in its cell (p.detail),
 * it shifts left so the excess characters move into the empty p.date column.
 * The rule between the two cells is then dropped on that row (print.css,
 * [data-spilled]) so it does not cut through the words; the heavy આવક/જાવક
 * rule on the date cell's other side stays.
 *
 * A description longer than both columns together wraps instead, across the
 * width of both, so it never runs into the voucher column. Runs before
 * spreadBlocks, so the extra lines are counted when the rows are sized.
 */
function spillCells(): void {
  for (const span of document.querySelectorAll<HTMLElement>(".print-root [data-spill-span]")) {
    span.style.transform = "";
    span.style.width = "";
    span.style.whiteSpace = "";
  }
  for (const cell of document.querySelectorAll<HTMLElement>(".print-root [data-spilled]")) {
    delete cell.dataset.spilled;
  }
  const cells = document.querySelectorAll<HTMLElement>(
    ".print-root .sheet:not([aria-hidden]) table.rojmel td[data-col='p.detail'][data-spill-left]",
  );
  // Every width is read first and written after, so the sheets are laid out once.
  const moves = [...cells].flatMap((cell) => {
    const span = cell.querySelector<HTMLElement>("[data-spill-span]");
    if (!span) return [];
    const spanRect = span.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const rightOverflow = spanRect.right - (cellRect.right - 2);
    if (rightOverflow <= 0) return [];
    const dateCellRect = cell.closest("tr")?.querySelector<HTMLElement>("td[data-col='p.date']")?.getBoundingClientRect();
    const maxShift = dateCellRect ? Math.max(0, spanRect.left - (dateCellRect.left + 2)) : 0;
    // Screen pixels per CSS pixel inside this cell: the sheet's and the table's zoom together.
    const scale = cell.offsetWidth > 0 ? cellRect.width / cell.offsetWidth : 1;
    const wrapWidth = cellRect.right - 2 - (dateCellRect ? dateCellRect.left + 2 : spanRect.left);
    return [{ cell, span, scale, wrap: rightOverflow > maxShift, shift: Math.min(rightOverflow, maxShift), wrapWidth, maxShift }];
  });
  for (const { cell, span, scale, wrap, shift, wrapWidth, maxShift } of moves) {
    // The words now reach into the date cell: no rule between the two.
    if (wrap ? maxShift > 0 : shift > 0) cell.dataset.spilled = "";
    if (wrap) {
      span.style.whiteSpace = "normal";
      span.style.width = `${wrapWidth / scale}px`;
      if (maxShift > 0) span.style.transform = `translateX(-${maxShift / scale}px)`;
    } else if (shift > 0) {
      span.style.transform = `translateX(-${shift / scale}px)`;
    }
  }
}

/** Moved-left descriptions that still reach past their own cell's right edge. */
function overflowingSpills(): number {
  const cells = document.querySelectorAll<HTMLElement>(
    ".print-root > .sheet:not([aria-hidden]) table.rojmel td[data-col='p.detail'][data-spill-left]",
  );
  return [...cells].filter((cell) => {
    const span = cell.querySelector<HTMLElement>("[data-spill-span]");
    return span ? span.getBoundingClientRect().right > cell.getBoundingClientRect().right + 1 : false;
  }).length;
}

/**
 * Cells whose text is wider than their column even after shrink-to-fit - an
 * amount in a column a school made too narrow. The text would print across the
 * next cell, so the editor says how many there are.
 */
function overflowingCells(): number {
  const cells = document.querySelectorAll<HTMLElement>(
    ".print-root > .sheet:not([aria-hidden]) table[data-layout] td:not([data-spill-left])",
  );
  return [...cells].filter((cell) => cell.scrollWidth > cell.clientWidth + 1).length;
}

/**
 * Sheets whose content no longer fits the paper - 1-based, in print order. The
 * forms fit by default; a school that makes the type larger or adds space can
 * push a sheet past its edge, and the PDF would silently crop it there. The
 * editor says so instead.
 */
function overflowingSheets(): number[] {
  const sheets = document.querySelectorAll<HTMLElement>(".print-root > .sheet:not([aria-hidden])");
  return [...sheets].flatMap((sheet, index) => {
    const room = parseFloat(getComputedStyle(sheet).minHeight);
    // A sheet is capped at one page and hides the rest (print.css), so its own
    // box never grows: what it holds is its scrollHeight.
    const tooTall =
      sheet.getBoundingClientRect().height / sheetZoom(sheet) > room + 1 ||
      sheet.scrollHeight > sheet.clientHeight + 1;
    const tooWide = sheet.scrollWidth > sheet.clientWidth + 1;
    return tooTall || tooWide ? [index + 1] : [];
  });
}

/** Everything a print page might need, fetched per report rather than always. */
interface PrintData {
  dashboard: DashboardDto;
  rojmel?: Rojmel;
  grantRegister?: GrantRegisterRowDto[];
  chequeRegister?: ChequeRegisterRow[];
  billRegister?: BillRegisterRow[];
  vouchers?: Voucher[];
  patrakD?: PatrakDRow[];
  ledgers?: Ledger[];
  annexure9?: Annexure9;
  /** The school's saved layout - unless the editor passed one to preview. */
  layout: ReportLayout;
}

export interface PrintRootProps {
  report: PrintableReport;
  /** A layout to preview instead of the saved one (the editor's draft). */
  layout?: ReportLayout;
  /** Extra rules for the editor: the selected cell's outline, the cursor. */
  editorCss?: string;
  /** Told, after every layout pass, what no longer fits: sheets (1-based) and cells. */
  onChecked?: (check: LayoutCheck) => void;
}

export interface LayoutCheck {
  /** Sheets taller or wider than the paper, 1-based in print order. */
  sheets: number[];
  /** How many cells hold text wider than their column. */
  cells: number;
}

/** The id the layout stylesheet is scoped to: it outranks print.css's classes. */
export const LAYOUT_ROOT_ID = "report-layout";

export function PrintRoot({ report, layout: draft, editorCss, onChecked }: PrintRootProps): JSX.Element {
  const [data, setData] = useState<PrintData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gate = usePrintLayoutGate();

  useEffect(() => {
    void (async () => {
      try {
        // Only what this report needs: the rojmel and the registers are far
        // larger than the dashboard, and fetching all of them for one page
        // would make every export pay for every report.
        const dashboard = await api.getDashboard();
        const next: PrintData = {
          dashboard,
          // The editor always passes its own; only the PDF and a plain preview
          // need the saved one.
          layout: draft ?? (await api.getReportLayout(report)),
        };

        if (report === "rojmel") next.rojmel = await api.getRojmel();
        if (report === "grantRegister") next.grantRegister = await api.getGrantRegister();
        if (report === "chequeRegister") next.chequeRegister = await api.getChequeRegister();
        if (report === "billRegister") next.billRegister = await api.getBillRegister();
        if (report === "vouchers") next.vouchers = await api.getVouchers();
        if (report === "patrakD") next.patrakD = await api.getPatrakD();
        if (report === "khatavahi") next.ledgers = await api.getLedgers();
        if (report === "annexure9") next.annexure9 = await api.getAnnexure9();

        setData(next);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    // The draft is read once, for the first paint; after that it arrives
    // through `layout` below without fetching the report's data again.
  }, [report]);

  const layout = draft ?? data?.layout;
  const layoutValue = useMemo<ReportLayoutValue | null>(
    () =>
      layout
        ? { report, layout, widths: columnWidths(report, layout), version: JSON.stringify(layout) }
        : null,
    [report, layout],
  );
  const version = layoutValue?.version ?? "";

  // Signal readiness only after the browser has painted the report, so
  // printToPDF cannot capture an empty page.
  const ready = error !== null || data !== null;

  // `settled` changes whenever a paged table finishes, so this re-checks then.
  // It also re-runs when the layout changes, so shrink-to-fit and the overflow
  // check follow the editor.
  const { pending, settled } = gate;
  useEffect(() => {
    if (!ready || pending() > 0) return;
    let cancelled = false;
    const signal = (): void => {
      if (cancelled || pending() > 0) return;
      cancelled = true;
      void layoutFontsReady(layoutValue?.layout).then(() => {
        if (pending() > 0) return;
        fitCells();
        spillCells();
        spreadBlocks();
        // Shaped headings are drawn last, at the size the report settled on.
        const root = document.getElementById(LAYOUT_ROOT_ID);
        if (root && layoutValue) paintShapes(root, layoutValue.layout);
        onChecked?.({ sheets: overflowingSheets(), cells: overflowingCells() + overflowingSpills() });
        window.__printReady = true;
      });
    };
    // After the browser has painted - or shortly after, in a window that is
    // never shown and so may never deliver an animation frame.
    const frame = requestAnimationFrame(() => requestAnimationFrame(signal));
    const timer = setTimeout(signal, 250);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
    // layoutValue changes exactly when `version` does; onChecked is a setter.
  }, [ready, pending, settled, version]);


  // The sheets themselves, rebuilt only when the data or the layout changes. The
  // editor re-renders this component for every click and pointer move (the
  // selection outline arrives as `editorCss`); without this, each of those would
  // rebuild every sheet of the report.
  const pages = useMemo(() => {
    if (!data || !layoutValue) return null;
    const { dashboard } = data;
    return (
      <>
        {report === "rojmel" &&
          data.rojmel?.pages.map((page, index) => (
            <RojmelSheet
              key={page.pageNo}
              school={dashboard.school}
              page={page}
              closingSentenceGu={data.rojmel!.closingSentenceGu}
              isLastPage={index === data.rojmel!.pages.length - 1}
            />
          ))}

        {report === "grantRegister" && data.grantRegister && (
          <GrantRegisterPages
            school={dashboard.school}
            year={dashboard.year}
            rows={data.grantRegister}
          />
        )}

        {report === "chequeRegister" && data.chequeRegister && (
          <ChequeRegisterPages
            school={dashboard.school}
            year={dashboard.year}
            rows={data.chequeRegister}
          />
        )}

        {report === "billRegister" && data.billRegister && (
          <BillRegisterPages
            school={dashboard.school}
            year={dashboard.year}
            rows={data.billRegister}
          />
        )}

        {report === "vouchers" && data.vouchers && (
          <VoucherPages school={dashboard.school} vouchers={data.vouchers} />
        )}

        {report === "patrakD" && data.patrakD && (
          <PatrakDPages school={dashboard.school} year={dashboard.year} rows={data.patrakD} />
        )}

        {report === "khatavahi" && data.ledgers && (
          <KhatavahiPages school={dashboard.school} year={dashboard.year} ledgers={data.ledgers} />
        )}

        {report === "annexure9" && data.annexure9 && (
          <Annexure9Page school={dashboard.school} year={dashboard.year} report={data.annexure9} />
        )}

        {report === "annexure10" && (
          <Annexure10Page
            school={dashboard.school}
            year={dashboard.year}
            report={dashboard.annexure10}
          />
        )}
      </>
    );
  }, [data, layoutValue, report]);

  if (error !== null) {
    return (
      <div className="print-root">
        <div className="sheet">માહિતી વાંચી શકાઈ નહીં: {error}</div>
      </div>
    );
  }

  if (!data || !layoutValue) {
    return (
      <div className="print-root">
        <div className="sheet">…</div>
      </div>
    );
  }

  const page = resolvePage(report, layoutValue.layout.page);
  // The sheet is the paper less its margins, laid out 1/zoom as large and
  // zoomed back onto the paper (print.css, ".sheet").
  const sheetVars = {
    "--sheet-width": `${page.contentWidthMm}mm`,
    "--sheet-height": `${page.contentHeightMm}mm`,
    "--sheet-zoom": String(page.scale),
    // The margins in the sheet's own (zoomed) mm, to draw the paper round it on screen.
    ...Object.fromEntries(
      MARGIN_EDGES.map((edge) => [`--sheet-m-${edge}`, `${Math.round((page.margins[edge] / page.scale) * 100) / 100}mm`]),
    ),
  } as CSSProperties;
  const { top, right, bottom, left } = page.margins;
  const centred = `${page.centerHorizontally ? " center-x" : ""}${page.centerVertically ? " center-y" : ""}`;

  return (
    <PrintLayoutGate.Provider value={gate.gate}>
      <ReportLayoutContext.Provider value={layoutValue}>
        <div id={LAYOUT_ROOT_ID} className={`print-root${centred}`} style={sheetVars}>
          {/*
          The page box, set per report from its page setup.
          `printToPDF` is called with preferCSSPageSize, so this rule - not the
          landscape flag passed to Electron - decides the actual paper and
          orientation. A single global `@page` would print all the landscape
          forms portrait, with their tables cropped down the right-hand side.
          The size is always the paper's own millimetres: the CSS keyword
          "legal" is US Legal (355.6mm), which made an Indian Legal (345mm)
          PDF 10mm too long, with a blank strip at its end.
          */}
          <style>{`@page { size: ${page.paperWidthMm}mm ${page.paperHeightMm}mm; margin: ${top}mm ${right}mm ${bottom}mm ${left}mm; }`}</style>
          {/* The school's layout, then - on the Reports screen - the editor's marks. */}
          <style>{layoutCss(report, layoutValue.layout, `#${LAYOUT_ROOT_ID}`)}</style>
          {editorCss && <style>{editorCss}</style>}

          {pages}
        </div>
      </ReportLayoutContext.Provider>
    </PrintLayoutGate.Provider>
  );
}
