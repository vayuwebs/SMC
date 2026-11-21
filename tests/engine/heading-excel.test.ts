/**
 * The Excel export follows a heading's placement: a row joined to the table
 * gets the table's thin lines all round. See heading-modes-design.md.
 */
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { applyHeading } from "../../src/server/excel.js";
import { emptyLayout, type ReportLayout } from "../../src/shared/report-layout.js";

const titleCell = (layout: ReportLayout): ExcelJS.Cell => {
  const cell = new ExcelJS.Workbook().addWorksheet("x").getCell("A1");
  cell.value = "SMC શાળા";
  applyHeading(cell, "rojmel", layout, (pt) => pt);
  return cell;
};

describe("the title row in Excel", () => {
  it("draws the table's thin line all round a title joined to the table", () => {
    const cell = titleCell({ ...emptyLayout(), lineColour: "#333333", styles: { "part:title": { headingMode: "row" } } });
    for (const side of ["top", "right", "bottom", "left"] as const) {
      expect(cell.border?.[side]).toEqual({ style: "thin", color: { argb: "FF333333" } });
    }
  });

  it("draws the join in the report's line weight", () => {
    const cell = titleCell({ ...emptyLayout(), lineWeight: "thick", styles: { "part:title": { headingMode: "row" } } });
    expect(cell.border?.bottom?.style).toBe("thick");
  });

  it("leaves a banner's or an untouched title's lines as they were", () => {
    expect(titleCell(emptyLayout()).border).toBeUndefined();
    const banner = titleCell({ ...emptyLayout(), styles: { "part:title": { headingMode: "banner", shape: "ribbon", fill: "#ffeeaa" } } });
    expect(banner.border?.top).toEqual({ style: "thin" });
  });

  it("gives readable words with the theme's colours on", () => {
    const cell = titleCell({ ...emptyLayout(), theme: "blue", matchTheme: true, styles: { "part:title": { headingMode: "row", fill: "#ffeb3b" } } });
    expect(cell.font?.color).toEqual({ argb: "FF000000" });
  });
});
