/**
 * Which ledger accounts share a sheet, where on it each one goes, and how tall
 * each is drawn so the sheet comes out symmetrical.
 *
 * The client's book prints the ખાતાવહી four accounts to a landscape sheet, two
 * across and two down. Accounts differ a lot in length - an interest account
 * has three entries, the cleanliness grant a dozen - so which four share a
 * sheet, and where each sits, is chosen by size rather than by print order
 * (the client: "order is not important; four to a page is"):
 *
 *   - Sheets are filled four at a time, so every sheet but the last is full.
 *     Each takes the largest and the smallest accounts left, then the next
 *     largest and next smallest, so long and short accounts share a sheet and
 *     no sheet is all long ones.
 *   - On a sheet the accounts stand in two ROWS of two (not two independent
 *     columns), so the two lower accounts start on the same line. The two
 *     larger accounts make the top row and the two smaller the bottom one:
 *     accounts of about the same length share a row, which is what leaves the
 *     least blank space when a row's two accounts are drawn the same height.
 *
 * Then `ledgerRowHeights` says how tall each row is drawn: the sheet split
 * into equal halves when both rows fit in half of it, otherwise as near equal
 * as the taller row allows. Both accounts in a row are drawn to that height
 * (with blank writing rows, KhatavahiPage.tsx), so the four blocks line up
 * like a 2 x 2 grid.
 *
 * Pure, so the arrangement is tested without a browser (tests/ledger-layout.test.ts).
 */

export const ACCOUNTS_PER_SHEET = 2;

/**
 * One sheet: its top row and its bottom row, each an account,
 * as indexes into the input. The bottom row may be empty on the last sheet.
 */
export type LedgerSheet = [number[], number[]];

/** Arrange accounts of the given sizes (any measure of height: rows will do). */
export function arrangeLedgers(sizes: readonly number[]): LedgerSheet[] {
  // Largest first; equal sizes keep their print order.
  const order = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size - a.size || a.index - b.index)
    .map((entry) => entry.index);

  const sheets: LedgerSheet[] = [];
  let low = 0;
  let high = order.length - 1;
  while (low <= high) {
    const chosen: number[] = [];
    // Largest, smallest.
    for (let pick = 0; pick < ACCOUNTS_PER_SHEET && low <= high; pick += 1) {
      chosen.push(pick % 2 === 0 ? order[low++]! : order[high--]!);
    }
    sheets.push(rowsOf(chosen, sizes));
  }
  return sheets;
}

/** Up to two accounts into two rows: larger on top, smaller below. */
function rowsOf(accounts: number[], sizes: readonly number[]): LedgerSheet {
  const bySize = [...accounts].sort((a, b) => sizes[b]! - sizes[a]! || a - b);
  return [bySize.slice(0, 1), bySize.slice(1, 2)];
}

/**
 * How tall to draw the sheet's two rows, given the room for them, the gap
 * between them and each row's natural height (its taller account; 0 for an
 * empty row). All in the same unit.
 *
 * The room is shared out like water poured into two jars: the shorter row is
 * raised first, until both are level, and then both together. So
 *
 *   - when both rows fit in half the room, each gets exactly half - four equal
 *     quarters, however few entries the accounts have (an empty bottom row
 *     still keeps its half, so a last sheet of one or two accounts looks like
 *     the top of every other sheet);
 *   - when one row needs more than half, it keeps what it needs and the other
 *     has the rest;
 *   - when the two need more than the room, they keep their natural heights
 *     and the sheet is zoomed down to fit (KhatavahiPage.tsx).
 *
 * A row is never drawn shorter than it is.
 */
export function ledgerRowHeights(room: number, natural: readonly [number, number], gap: number): [number, number] {
  const [top, bottom] = natural;
  const free = room - gap;
  if (top + bottom >= free) return [top, bottom];
  const half = free / 2;
  if (top <= half && bottom <= half) return [half, half];
  // One row is taller than half: it keeps its height, the other fills up.
  return top > bottom ? [top, free - top] : [free - bottom, bottom];
}

/**
 * How to bring one account up to its row's height: whole blank rows first
 * (`rowPx` each, as tall as the account's own blank row), then the few pixels
 * left, to be shared among its blank rows. Never adds more than the deficit.
 */
export function ledgerFill(deficitPx: number, rowPx: number): { rows: number; leftPx: number } {
  if (deficitPx <= 0) return { rows: 0, leftPx: 0 };
  if (rowPx <= 0) return { rows: 0, leftPx: deficitPx };
  const rows = Math.floor(deficitPx / rowPx);
  return { rows, leftPx: deficitPx - rows * rowPx };
}
