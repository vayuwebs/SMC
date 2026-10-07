/**
 * The ledger's four-to-a-sheet arrangement: every account placed exactly once,
 * four to a sheet, long and short accounts mixed, in two rows of two - and the
 * heights that make the sheet a symmetrical 2 x 2 grid.
 */
import { describe, expect, it } from "vitest";
import { arrangeLedgers, ledgerFill, ledgerRowHeights } from "../src/shared/ledger-layout.js";

const all = (sheets: ReturnType<typeof arrangeLedgers>): number[] =>
  sheets.flatMap(([top, bottom]) => [...top, ...bottom]).sort((a, b) => a - b);

describe("four accounts to a sheet", () => {
  it("places every account once, four to every sheet but the last", () => {
    const sizes = [12, 3, 8, 5, 4, 9, 2, 7, 6];
    const sheets = arrangeLedgers(sizes);
    expect(all(sheets)).toEqual(sizes.map((_, index) => index));
    expect(sheets.map(([top, bottom]) => top.length + bottom.length)).toEqual([4, 4, 1]);
  });

  it("puts the two larger accounts in the top row and the two smaller below, larger on the left", () => {
    // Sizes 10, 8, 3, 1: top row 10 and 8, bottom row 3 and 1.
    const [sheet] = arrangeLedgers([3, 10, 1, 8]);
    expect(sheet).toEqual([
      [1, 3],
      [0, 2],
    ]);
  });

  it("mixes long and short accounts across sheets", () => {
    const sizes = [20, 19, 18, 17, 4, 3, 2, 1];
    const sheets = arrangeLedgers(sizes);
    // Each sheet's height is its two rows' taller accounts. Not 20+19 and
    // 18+17 on one sheet: each sheet has a long row and a short one.
    const heights = sheets.map(([top, bottom]) =>
      [top, bottom].reduce((sum, row) => sum + Math.max(0, ...row.map((index) => sizes[index]!)), 0),
    );
    expect(Math.max(...heights)).toBeLessThanOrEqual(24);
  });

  it("copes with fewer than four", () => {
    expect(arrangeLedgers([])).toEqual([]);
    expect(arrangeLedgers([5])).toEqual([[[0], []]]);
    expect(arrangeLedgers([2, 5, 3])).toEqual([[[1, 2], [0]]]);
  });
});

describe("a symmetrical sheet", () => {
  it("splits the sheet into equal halves when both rows fit in half", () => {
    // 100 of room, 4 between the rows: 48 each, whatever the rows hold.
    expect(ledgerRowHeights(100, [30, 12], 4)).toEqual([48, 48]);
    expect(ledgerRowHeights(100, [48, 48], 4)).toEqual([48, 48]);
    // An empty bottom row keeps its half, so the top row looks like every other sheet's.
    expect(ledgerRowHeights(100, [20, 0], 4)).toEqual([48, 48]);
  });

  it("lets a row taller than half keep its height and gives the other the rest", () => {
    expect(ledgerRowHeights(100, [60, 20], 4)).toEqual([60, 36]);
    expect(ledgerRowHeights(100, [20, 60], 4)).toEqual([36, 60]);
  });

  it("never draws a row shorter than it is", () => {
    // Too tall together: natural heights, and the sheet is zoomed instead.
    expect(ledgerRowHeights(100, [70, 40], 4)).toEqual([70, 40]);
    for (const natural of [
      [10, 10],
      [50, 5],
      [96, 0],
      [0, 0],
    ] as [number, number][]) {
      const [top, bottom] = ledgerRowHeights(100, natural, 4);
      expect(top).toBeGreaterThanOrEqual(natural[0]);
      expect(bottom).toBeGreaterThanOrEqual(natural[1]);
      expect(top + bottom + 4).toBeCloseTo(100, 6);
    }
  });

  it("makes an account up with whole blank rows, then the pixels left", () => {
    expect(ledgerFill(70, 20)).toEqual({ rows: 3, leftPx: 10 });
    expect(ledgerFill(19, 20)).toEqual({ rows: 0, leftPx: 19 });
    expect(ledgerFill(0, 20)).toEqual({ rows: 0, leftPx: 0 });
    expect(ledgerFill(-5, 20)).toEqual({ rows: 0, leftPx: 0 });
  });
});
