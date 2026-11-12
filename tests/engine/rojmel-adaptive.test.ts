import { describe, expect, it } from "vitest";
import type { RojmelBlock, RojmelLine, RojmelPage } from "../../src/engine/rojmel.js";
import {
  adaptiveRojmelWidths,
  balancingShiftPx,
  calculateFitScale,
  isDenseRojmelPage,
  largestFittingScale,
  REBALANCED_ROJMEL_WIDTHS,
  ROJMEL_MIN_SCALE,
  STANDARD_ROJMEL_WIDTHS,
  targetBodyRowHeightMm,
  WRAPPED_ROJMEL_MIN_SCALE,
} from "../../src/shared/rojmel-adaptive.js";
import { emptyLayout, type ReportLayout } from "../../src/shared/report-layout.js";

import { paise, ZERO } from "../../src/lib/money.js";

function dummyLine(side: "receipt" | "payment", descriptionGu = "ટેસ્ટ વિગત"): RojmelLine {
  return {
    side,
    dateText: "01/05/2025",
    descriptionGu,
    referenceText: "1/1 01/05/2025",
    chequeText: "101 01/05/2025",
    cashPaise: ZERO,
    bankPaise: paise(10000),
    totalPaise: paise(10000),
    headingOnly: false,
    source: { kind: "none" },
  };
}

function dummyBlock(paymentLineCount: number, receiptLineCount = 2, desc = "બિલ ચૂકવણી"): RojmelBlock {
  const spent = paise(paymentLineCount * 10000);
  const total = paise(5000000);
  const closing = paise(5000000 - paymentLineCount * 10000);
  return {
    id: "2025-05-01",
    fromDate: "2025-05-01",
    toDate: "2025-05-01",
    isNil: false,
    openingCashPaise: ZERO,
    openingBankPaise: total,
    receiptLines: Array.from({ length: receiptLineCount }, () => dummyLine("receipt", "ગ્રાન્ટ જમા")),
    paymentLines: Array.from({ length: paymentLineCount }, (_, i) => dummyLine("payment", `${desc} ${i + 1}`)),
    spentCashPaise: ZERO,
    spentBankPaise: spent,
    spentTotalPaise: spent,
    closingCashPaise: ZERO,
    closingBankPaise: closing,
    closingTotalPaise: closing,
    receiptTotalCashPaise: ZERO,
    receiptTotalBankPaise: total,
    receiptTotalTotalPaise: total,
    rowCount: Math.max(receiptLineCount, paymentLineCount) + 3,
  };
}

describe("Adaptive Legal Sheet Algorithm", () => {
  describe("Stage 1: Content-Aware Column Width Rebalancing", () => {
    it("identifies a dense page when total rows > 15", () => {
      // 13 payment lines + 3 footers = 16 rows > 15
      const densePage: RojmelPage = { pageNo: 1, blocks: [dummyBlock(13)] };
      expect(isDenseRojmelPage(densePage)).toBe(true);

      const widths = adaptiveRojmelWidths(densePage);
      expect(widths["p.detail"]).toBe(16.0);
      expect(widths["r.detail"]).toBe(8.5);
      expect(widths["r.ref"]).toBe(5.0);
      expect(widths["r.cheque"]).toBe(5.0);
      expect(widths["r.cash"]).toBe(6.0);
      expect(widths["p.cash"]).toBe(6.0);

      // Verify total sum is exactly 100%
      const sum = Object.values(widths).reduce((acc, w) => acc + w, 0);
      expect(Math.round(sum * 10) / 10).toBe(100);

      // Verify receipt half is 44.9%
      const receiptHalf = Object.entries(widths)
        .filter(([id]) => id.startsWith("r."))
        .reduce((acc, [, w]) => acc + w, 0);
      expect(Math.round(receiptHalf * 10) / 10).toBe(44.9);
    });

    it("retains standard balanced widths when page is not dense (<= 15 rows)", () => {
      // 5 payment lines + 3 footers = 8 rows <= 15
      const amplePage: RojmelPage = { pageNo: 1, blocks: [dummyBlock(5)] };
      expect(isDenseRojmelPage(amplePage)).toBe(false);

      const widths = adaptiveRojmelWidths(amplePage);
      expect(widths["p.detail"]).toBe(14.5);
      expect(widths["r.detail"]).toBe(9.5);
      expect(widths["r.ref"]).toBe(5.0);
      expect(widths["r.cheque"]).toBe(5.0);
      expect(widths["r.cash"]).toBe(6.0);
      expect(widths["p.cash"]).toBe(6.0);

      // Verify receipt half is 45.9%
      const receiptHalf = Object.entries(widths)
        .filter(([id]) => id.startsWith("r."))
        .reduce((acc, [, w]) => acc + w, 0);
      expect(Math.round(receiptHalf * 10) / 10).toBe(45.9);
    });

    it("rebalances when payment lines > 10 even if total rows threshold is borderline", () => {
      const page: RojmelPage = { pageNo: 1, blocks: [dummyBlock(11)] };
      expect(isDenseRojmelPage(page)).toBe(true);
      const widths = adaptiveRojmelWidths(page);
      expect(widths).toEqual(REBALANCED_ROJMEL_WIDTHS);
    });

    it("honours user-customized layout widths if explicitly set in layout", () => {
      const customLayout: ReportLayout = {
        ...emptyLayout(),
        widths: { "p.detail": 25, "r.detail": 15 },
      };
      const densePage: RojmelPage = { pageNo: 1, blocks: [dummyBlock(18)] };
      const widths = adaptiveRojmelWidths(densePage, customLayout);
      // User manual widths win
      expect(widths["p.detail"]).toBeDefined();
      expect(widths["p.detail"]).not.toBe(16.0);
    });
  });

  describe("Stage 2 & 3: Typography and Vertical Budgeting", () => {
    it("computes row height of 6.8mm for ample blocks (<= 15 rows)", () => {
      expect(targetBodyRowHeightMm(10)).toBe(6.8);
      expect(targetBodyRowHeightMm(14)).toBe(6.8);
    });

    it("compresses row height to 5.0mm - 5.4mm for dense blocks (20 - 26 rows)", () => {
      const h22 = targetBodyRowHeightMm(22);
      expect(h22).toBeLessThanOrEqual(5.4);
      expect(h22).toBeGreaterThanOrEqual(5.0);

      const h26 = targetBodyRowHeightMm(26);
      expect(h26).toBeLessThanOrEqual(5.4);
      expect(h26).toBeGreaterThanOrEqual(5.0);
    });

    it("does not compress below 4.6mm even for very high row counts", () => {
      expect(targetBodyRowHeightMm(35)).toBe(4.6);
    });
  });

  describe("Stage 4: Mathematical Precision Zoom-to-Fit Floor", () => {
    it("returns 1 when content height fits comfortably within available height", () => {
      const scale = calculateFitScale(650, 774.8, 4);
      expect(scale).toBe(1);
    });

    it("calculates exact scale factor when content overflows (e.g. 26-28 wrapped bills)", () => {
      // Rendered height 820px, available 774.8px - 4px safety = 770.8px
      const scale = calculateFitScale(820, 774.8, 4);
      expect(scale).toBeLessThan(1);
      expect(scale).toBeCloseTo(770.8 / 820, 2);

      // Verifying zero clipping: content * scale <= available - safety
      expect(820 * scale).toBeLessThanOrEqual(774.8);
    });

    it("clamps minimum scale to gentle non-extreme floor (0.88) to prevent unreadable degeneration", () => {
      const scale = calculateFitScale(2000, 774.8, 4);
      expect(scale).toBe(0.88);
    });

    it("finds the largest zoom a wrapped sheet fits at, however its lines change with the zoom", () => {
      // Below 0.9 the words fit on fewer lines, so the height drops suddenly -
      // a sum from the height at full size would have gone far past this.
      const heightAt = (scale: number): number => (scale < 0.9 ? 700 : 1000) * scale;
      const scale = largestFittingScale((candidate) => heightAt(candidate) <= 774);
      expect(scale).toBeLessThan(0.9);
      expect(scale).toBeGreaterThan(0.89);
      expect(heightAt(scale)).toBeLessThanOrEqual(774);
    });

    it("lets a wrapped sheet go past the plain floor, and stops at its own", () => {
      expect(WRAPPED_ROJMEL_MIN_SCALE).toBeLessThan(ROJMEL_MIN_SCALE);
      expect(largestFittingScale(() => false)).toBe(WRAPPED_ROJMEL_MIN_SCALE);
      expect(largestFittingScale(() => true)).toBeGreaterThan(0.99);
    });
  });
});

describe("balancingShiftPx", () => {
  it("splits the leftover so the white above the ink equals the white below the table", () => {
    const m = { inkTopPx: 6, bottomGapPx: 4, marginTopPx: 37.8, marginBottomPx: 37.8 };
    const shift = balancingShiftPx(m);
    expect(m.marginTopPx + m.inkTopPx + shift).toBeCloseTo(m.marginBottomPx + m.bottomGapPx - shift);
  });

  it("pulls the title up when its line box holds more white than the bottom", () => {
    expect(balancingShiftPx({ inkTopPx: 10, bottomGapPx: 2, marginTopPx: 30, marginBottomPx: 30 })).toBe(-4);
  });

  it("allows for unequal page margins", () => {
    const m = { inkTopPx: 4, bottomGapPx: 20, marginTopPx: 20, marginBottomPx: 40 };
    const shift = balancingShiftPx(m);
    expect(m.marginTopPx + m.inkTopPx + shift).toBeCloseTo(m.marginBottomPx + m.bottomGapPx - shift);
  });

  it("never moves the ink off the top nor the table off the bottom", () => {
    expect(balancingShiftPx({ inkTopPx: 3, bottomGapPx: 0, marginTopPx: 80, marginBottomPx: 10 })).toBe(-3);
    expect(balancingShiftPx({ inkTopPx: 3, bottomGapPx: 5, marginTopPx: 10, marginBottomPx: 80 })).toBe(5);
  });
});
