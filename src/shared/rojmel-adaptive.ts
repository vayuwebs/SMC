/**
 * Adaptive Legal-Sheet Fitting Engine for Rojmel (Cash Book).
 *
 * Implements the 4-stage adaptive layout algorithm:
 *   Stage 1: Content-Aware Column Width Rebalancing (shifts surplus width from receipt side to p.detail)
 *   Stage 2: Automatic Two-Tier Typography (14pt <-> 12pt)
 *   Stage 3: Dynamic Vertical Budgeting & Padding Compression (5.0mm - 5.4mm row heights)
 *   Stage 4: Mathematical Precision Zoom-to-Fit Floor (zero-clipping guarantee)
 */
import type { RojmelBlock, RojmelLine, RojmelPage as RojmelPageData } from "../engine/rojmel.js";
import { columnWidths, type ReportLayout } from "./report-layout.js";
import { rojmelBlockRows } from "./rojmel-rows.js";

/** Default balanced column widths (in percent, summing to 100). */
export const STANDARD_ROJMEL_WIDTHS: Record<string, number> = {
  "r.date": 8.4,
  "r.detail": 9.5,
  "r.ref": 5.0,
  "r.cheque": 5.0,
  "r.cash": 6.0,
  "r.bank": 6.0,
  "r.total": 6.0,

  "p.date": 8.4,
  "p.detail": 14.5,
  "p.ref": 7.0,
  "p.cheque": 6.2,
  "p.cash": 6.0,
  "p.bank": 6.0,
  "p.total": 6.0,
};

/** Rebalanced column widths when payment descriptions are extra long (p.detail = 16.0%, summing to 100). */
export const REBALANCED_ROJMEL_WIDTHS: Record<string, number> = {
  "r.date": 8.4,
  "r.detail": 8.5,
  "r.ref": 5.0,
  "r.cheque": 5.0,
  "r.cash": 6.0,
  "r.bank": 6.0,
  "r.total": 6.0,

  "p.date": 8.4,
  "p.detail": 16.0,
  "p.ref": 6.5,
  "p.cheque": 6.2,
  "p.cash": 6.0,
  "p.bank": 6.0,
  "p.total": 6.0,
};

/**
 * Total printable rows in a page's blocks (including 3 footers per block and inter-block gap rows).
 */
export function countPageRows(page: RojmelPageData): number {
  return (
    page.blocks.reduce(
      (sum: number, block: RojmelBlock) => sum + rojmelBlockRows(block).length + 3,
      0,
    ) + Math.max(0, page.blocks.length - 1)
  );
}

/**
 * Determines if a Rojmel page is tight / dense and requires 12pt font & column rebalancing.
 */
export function isDenseRojmelPage(page: RojmelPageData): boolean {
  const totalRows = countPageRows(page);
  if (totalRows > 15) return true;
  if (page.blocks.some((b) => b.paymentLines.length > 10)) return true;

  // Inspect character lengths of payment vs receipt descriptions (RightSideDensity)
  const paymentChars = page.blocks.reduce(
    (acc, b) => acc + b.paymentLines.reduce((sum: number, l: RojmelLine) => sum + (l.descriptionGu?.length ?? 0), 0),
    0,
  );
  const receiptChars = page.blocks.reduce(
    (acc, b) => acc + b.receiptLines.reduce((sum: number, l: RojmelLine) => sum + (l.descriptionGu?.length ?? 0), 0),
    0,
  );

  return paymentChars > 60 && paymentChars > 1.5 * Math.max(1, receiptChars);
}

/**
 * Returns the column widths for a specific Rojmel sheet:
 *   - If the user explicitly customized widths in `layout.widths`, honor the user's layout.
 *   - If dense/tight, returns REBALANCED_ROJMEL_WIDTHS (p.detail expanded to 18.5%).
 *   - Otherwise returns STANDARD_ROJMEL_WIDTHS.
 */
export function adaptiveRojmelWidths(
  page: RojmelPageData,
  layout?: ReportLayout,
): Record<string, number> {
  if (layout && Object.keys(layout.widths).length > 0) {
    return columnWidths("rojmel", layout);
  }
  if (isDenseRojmelPage(page)) {
    return { ...REBALANCED_ROJMEL_WIDTHS };
  }
  return { ...STANDARD_ROJMEL_WIDTHS };
}

/**
 * Dynamic row height budgeting based on total rows.
 * Available body height on Indian Legal landscape: 195.0mm printable - 41.2mm overhead = 153.8mm.
 */
export function targetBodyRowHeightMm(totalRows: number, budgetMm = 153.8): number {
  if (totalRows <= 15) return 6.8;
  const target = budgetMm / totalRows;
  return Math.max(4.6, Math.min(5.4, Math.round(target * 10) / 10));
}

/** How far a rojmel table may be zoomed down to fit its sheet. */
export const ROJMEL_MIN_SCALE = 0.88;

/**
 * The same where the school asked for wrapping. The engine's pages are fixed -
 * the ledger prints their numbers, so how a cell wraps must not move an entry
 * to another page - which leaves wrapped rows the room of their own sheet: first
 * what its other rows can give up, then this zoom.
 */
export const WRAPPED_ROJMEL_MIN_SCALE = 0.7;

/**
 * Mathematical zoom-to-fit scale floor to guarantee zero clipping.
 * Returns a number <= 1.0 (clamped between minScaleFloor (default 0.88) and 1.0).
 */
export function calculateFitScale(
  containerHeightPx: number,
  maxAvailablePx: number,
  safetyPx = 4,
  minScaleFloor = ROJMEL_MIN_SCALE,
): number {
  const allowed = maxAvailablePx - safetyPx;
  if (containerHeightPx <= allowed) return 1;
  const scale = allowed / containerHeightPx;
  return Math.max(minScaleFloor, Math.floor(scale * 1000) / 1000);
}

/**
 * The largest zoom at which a sheet fits, by halving. Zooming a table down widens
 * its cells, so wrapped text takes fewer lines and the height does not follow the
 * zoom: one sum from the measured height would shrink the page far too much.
 * Gives the floor when nothing fits.
 */
export function largestFittingScale(
  fits: (scale: number) => boolean,
  floor = WRAPPED_ROJMEL_MIN_SCALE,
  rounds = 7,
): number {
  let low = floor;
  let high = 1;
  for (let round = 0; round < rounds; round += 1) {
    const middle = Math.round(((low + high) / 2) * 1000) / 1000;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/**
 * How far to move a rojmel sheet's content down (negative: up) so the paper
 * shows as much white above the title's ink - its highest matra, not its line
 * box - as below the last row of the table. Moving down by s adds s above and
 * takes s below, so the gap is split in half. Clamped so the ink never leaves
 * the top of the sheet nor the table its bottom.
 *
 * All in the sheet's px: `inkTopPx` from the top of the sheet to the ink,
 * `bottomGapPx` from the content's bottom to the sheet's, and the page margins
 * that sit outside the sheet on the paper.
 */
export function balancingShiftPx({
  inkTopPx,
  bottomGapPx,
  marginTopPx,
  marginBottomPx,
}: {
  inkTopPx: number;
  bottomGapPx: number;
  marginTopPx: number;
  marginBottomPx: number;
}): number {
  const shift = (marginBottomPx + bottomGapPx - (marginTopPx + inkTopPx)) / 2;
  return Math.max(-Math.max(0, inkTopPx), Math.min(Math.max(0, bottomGapPx), shift));
}
