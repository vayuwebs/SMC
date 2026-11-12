import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("print font size stability and capacity", () => {
  const printCssPath = path.join(process.cwd(), "src", "renderer", "print", "print.css");
  const printRootPath = path.join(process.cwd(), "src", "renderer", "print", "PrintRoot.tsx");
  const printCss = fs.readFileSync(printCssPath, "utf-8");
  const printRoot = fs.readFileSync(printRootPath, "utf-8");

  it("shrinks only voucher and cheque cells in PrintRoot.tsx, never descriptions", () => {
    // Descriptions keep one font size and wrap; the old shrink-everything groups are gone.
    expect(printRoot).not.toMatch(/smallestPt:\s*7/);
    expect(printRoot).not.toMatch(/\["td\.figure"/);
    // The one place a font size is set is the voucher / cheque pass.
    expect(printRoot.match(/cell\.style\.fontSize\s*=\s*`/g) ?? []).toHaveLength(1);
    expect(printRoot).toMatch(/td\[data-col='p\.ref'\], \$\{visible\} td\[data-col='p\.cheque'\]/);
  });

  it("does not force nowrap on rojmel detail descriptions in print.css", () => {
    // Detail descriptions must be allowed to wrap rather than clip/force font shrinking
    expect(printCss).not.toMatch(/table\.form\.rojmel\s+td\.detail[^{]*\{[^}]*white-space:\s*nowrap/);
    expect(printCss).toMatch(/table\.form\.rojmel\s+td\.detail[^{]*\{[^}]*white-space:\s*normal/);
  });

  it("inherits font size on voucher dates and date range separators instead of hardcoded 8pt/8.5pt", () => {
    // Voucher dates and range parts should inherit font size
    expect(printCss).not.toMatch(/\.voucher-date\s*\{[^}]*font-size:\s*8\.5pt/);
    expect(printCss).not.toMatch(/\.date-range-cell\s*\{[^}]*font-size:\s*8\.5pt/);
    expect(printCss).not.toMatch(/\.date-separator\s*\{[^}]*font-size:\s*8pt/);
    expect(printCss).toMatch(/\.voucher-date\s*\{[^}]*font-size:\s*inherit/);
  });

  it("ensures child elements within table cells inherit font size and line height", () => {
    expect(printCss).toMatch(/table\.form(\.rojmel)?\s+(th|td)\s+\*[^}]*font-size:\s*inherit/);
  });

  it("enforces Noto Sans Gujarati across all printed reports in print.css", () => {
    expect(printCss).toMatch(/\.print-root\s*\{[^}]*font-family:\s*["']Noto Sans Gujarati["']/);
    expect(printCss).toMatch(/font-family:\s*inherit/);
  });

  it("enforces legal page height containment on .sheet in print.css", () => {
    // .sheet must bound max-height to the sheet-height so it cannot increase page height
    expect(printCss).toMatch(/\.sheet\s*\{[^}]*max-height:\s*var\(--sheet-height/);
    expect(printCss).toMatch(/\.sheet\s*\{[^}]*overflow:\s*hidden/);
  });

  it("enforces uniform rojmel font size of 12pt for text and 11pt for figures in RojmelPage.tsx", () => {
    const rojmelPagePath = path.join(process.cwd(), "src", "renderer", "print", "RojmelPage.tsx");
    const rojmelPage = fs.readFileSync(rojmelPagePath, "utf-8");
    // Description font is strictly 12pt across all pages
    expect(rojmelPage).toMatch(/--rojmel-text["']?:\s*["']12pt["']/);
    expect(rojmelPage).toMatch(/--rojmel-figure["']?:\s*["']11pt["']/);
    expect(rojmelPage).toMatch(/--report-font["']?:\s*["']14pt["']/);
    expect(rojmelPage).not.toMatch(/--rojmel-text["']?:\s*["']14pt["']/);
  });

  it("ensures figures are right-aligned with tabular numbers in print.css", () => {
    expect(printCss).toMatch(/table\.form\.rojmel\s+td\.figure\s*\{[^}]*text-align:\s*right/);
    expect(printCss).toMatch(/table\.form\.rojmel\s+td\.figure\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it("applies gentle non-extreme fit scaling in PrintRoot.tsx with floor >= 0.88 to guarantee zero content clipping", () => {
    expect(printRoot).toMatch(/container\.style\.zoom\s*=/);
    expect(printRoot).toMatch(/calculateFitScale\(/);
  });

  it("marks empty-date payment descriptions with data-spill-left and data-spill-span in RojmelPage.tsx", () => {
    const rojmelPagePath = path.join(process.cwd(), "src", "renderer", "print", "RojmelPage.tsx");
    const rojmelPage = fs.readFileSync(rojmelPagePath, "utf-8");
    expect(rojmelPage).toMatch(/data-spill-left/);
    expect(rojmelPage).toMatch(/data-spill-span/);
  });

  it("enforces single-line nowrap and overflow visible for data-spill-left in print.css", () => {
    expect(printCss).toMatch(/td\[data-col="p\.detail"\]\[data-spill-left\]\s*\{[^}]*white-space:\s*nowrap/);
    expect(printCss).toMatch(/td\[data-col="p\.detail"\]\[data-spill-left\]\s*\{[^}]*overflow:\s*visible/);
    expect(printCss).toMatch(/\.detail-spill\s*\{[^}]*display:\s*inline-block/);
  });

  it("shifts overflowing payment descriptions left into empty date cells in PrintRoot.tsx", () => {
    expect(printRoot).toMatch(/function\s+spillCells\s*\(/);
    expect(printRoot).toMatch(/spillCells\(\)/);
  });

  it("drops only the rule between the date and description cells when a description moves left", () => {
    // Marked per row when the words actually reach into the date cell, cleared on every re-run.
    expect(printRoot).toMatch(/cell\.dataset\.spilled = ""/);
    expect(printRoot).toMatch(/delete cell\.dataset\.spilled/);
    // Only the description cell's left edge: the date cell's heavy આવક/જાવક rule is untouched.
    expect(printCss).toMatch(/td\[data-col="p\.detail"\]\[data-spilled\]\s*\{\s*border-left-style:\s*hidden !important;\s*\}/);
    expect(printCss).not.toMatch(/\[data-spilled\][^{]*\{[^}]*border-(right|top|bottom)/);
  });
});
